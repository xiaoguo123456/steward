package captures

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

// preprocessMedia 把图片与音频转成文字，对应状态机中的 preprocessing 阶段。
//
// 三条约束：
//   - Provider 调用在事务外进行，只有保存结果时才开短事务。
//   - 单项失败不影响其他输入项：失败项标记为 failed，其余继续解析。
//   - 提取出的文字属于用户资料，不是系统指令；后续 Prompt 会把它放进素材区。
func (s *Service) preprocessMedia(ctx context.Context, args CaptureParseArgs,
	parts []dbgen.CapturePart) []dbgen.CapturePart {

	out := make([]dbgen.CapturePart, len(parts))
	copy(out, parts)

	for i, part := range out {
		if part.Kind == "text" || part.Status == "succeeded" || part.Status == "ignored" {
			continue
		}
		if part.MediaID == nil || *part.MediaID == "" {
			s.markPartFailed(ctx, args.UserID, &out[i], "这条输入没有关联到已上传的文件。")
			continue
		}

		text, err := s.extractText(ctx, args.UserID, part)
		if err != nil {
			s.markPartFailed(ctx, args.UserID, &out[i], failureMessage(part.Kind, err))
			continue
		}
		if strings.TrimSpace(text) == "" {
			s.markPartFailed(ctx, args.UserID, &out[i],
				"没有从这个文件里识别到可用内容，请补充文字说明。")
			continue
		}

		out[i].Text = &text
		out[i].Status = "succeeded"
		_ = s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
			return q.UpdateCapturePartResult(ctx, dbgen.UpdateCapturePartResultParams{
				ID: part.ID, Status: "succeeded", Text: &text,
			})
		})
	}
	return out
}

// extractText 按输入项类型选择 OCR 或转写。
func (s *Service) extractText(ctx context.Context, userID string, part dbgen.CapturePart) (string, error) {
	if s.processor == nil {
		// 没有配置模型时不伪造识别结果，明确告诉用户这条路暂时走不通。
		return "", ai.ErrProviderUnavailable
	}

	asset, err := s.media.ResolveForParse(ctx, userID, *part.MediaID)
	if err != nil {
		return "", err
	}

	limit := storage.MaxBytesFor(asset.ContentType)
	data, err := s.media.ReadBytes(ctx, asset.ObjectKey, limit)
	if err != nil {
		return "", err
	}

	input := ai.MediaInput{ContentType: asset.ContentType, Data: data}
	switch part.Kind {
	case "image":
		text, _, err := s.processor.ExtractFromImage(ctx, input)
		return text, err
	case "audio":
		text, _, err := s.processor.Transcribe(ctx, input)
		return text, err
	default:
		return "", apperr.Newf(apperr.CodeValidationFailed, "不支持的输入类型。")
	}
}

// markPartFailed 把单个输入项标记为失败。
//
// 只有这一项进入 failed，其余输入项继续解析，对应状态机里的 partially_failed。
func (s *Service) markPartFailed(ctx context.Context, userID string,
	part *dbgen.CapturePart, message string) {

	body, _ := json.Marshal(map[string]any{
		"code":      string(apperr.CodeValidationFailed),
		"message":   message,
		"retryable": true,
	})
	part.Status = "failed"

	_ = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		return q.UpdateCapturePartResult(ctx, dbgen.UpdateCapturePartResultParams{
			ID: part.ID, Status: "failed", Error: body,
		})
	})
}

func failureMessage(kind string, err error) string {
	switch {
	case err == nil:
		return "处理失败，请重试。"
	case kind == "audio":
		return "语音转写暂时不可用，请改用文字描述。"
	default:
		return "图片识别暂时不可用，请改用文字描述。"
	}
}
