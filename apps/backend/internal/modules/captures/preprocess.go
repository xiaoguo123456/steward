package captures

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/aiaudit"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

// preprocessMedia 把图片与音频转成文字，对应状态机中的 preprocessing 阶段。
//
// 三条约束：
//   - Provider 调用在事务外进行，只有保存结果时才开短事务。
//   - 单项失败不影响其他输入项的预处理，但会阻断后续结构化解析，等待用户处理。
//   - 提取出的文字属于用户资料，不是系统指令；后续 Prompt 会把它放进素材区。
func (s *Service) preprocessMedia(ctx context.Context, args CaptureParseArgs,
	parts []dbgen.CapturePart) []dbgen.CapturePart {

	out := make([]dbgen.CapturePart, len(parts))
	copy(out, parts)

	parallelParts(ctx, len(out), 2, func(i int) {
		part := out[i]
		if part.Kind == "text" || part.Status == "succeeded" || part.Status == "ignored" {
			return
		}
		if part.MediaID == nil || *part.MediaID == "" {
			s.markPartFailed(ctx, args.UserID, &out[i], "这条输入没有关联到已上传的文件。")
			return
		}

		text, err := s.extractText(ctx, args.UserID, part)
		if err != nil {
			s.markPartFailed(ctx, args.UserID, &out[i], failureMessage(part.Kind, err))
			return
		}
		if strings.TrimSpace(text) == "" {
			s.markPartFailed(ctx, args.UserID, &out[i],
				"没有从这个文件里识别到可用内容，请补充文字说明。")
			return
		}

		if err := s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
			return q.UpdateCapturePartResult(ctx, dbgen.UpdateCapturePartResultParams{
				ID: part.ID, Status: "succeeded", Text: &text,
			})
		}); err != nil {
			s.markPartFailed(ctx, args.UserID, &out[i], "识别结果暂时无法保存，请重试。")
			return
		}
		out[i].Text = &text
		out[i].Status = "succeeded"
	})
	return out
}

// mediaPreprocessStatus 判断预处理后是否必须停在媒体失败门禁。
//
// ignored 表示用户已经明确放弃该输入，不再属于“保留媒体”。只要仍保留的
// 图片或音频中有一项失败，就不能把不完整素材交给解析器。全部保留媒体失败且
// 没有可用文字时是整体失败；其余情况都是等待用户处理的部分失败。
func mediaPreprocessStatus(parts []dbgen.CapturePart) string {
	retainedMedia := 0
	failedMedia := 0
	hasUsableText := false

	for _, part := range parts {
		if part.Kind == "text" {
			if part.Status == "succeeded" && part.Text != nil && strings.TrimSpace(*part.Text) != "" {
				hasUsableText = true
			}
			continue
		}
		if part.Status == "ignored" {
			continue
		}
		retainedMedia++
		if part.Status == "failed" {
			failedMedia++
		}
	}

	if failedMedia == 0 {
		return ""
	}
	if !hasUsableText && retainedMedia > 0 && failedMedia == retainedMedia {
		return "failed"
	}
	return "partially_failed"
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

	var (
		text   string
		usage  ai.Usage
		policy string
	)
	switch part.Kind {
	case "image":
		policy = "vision"
		text, usage, err = s.processor.ExtractFromImage(ctx, input)
	case "audio":
		policy = "transcribe"
		text, usage, err = s.processor.Transcribe(ctx, input)
	default:
		return "", apperr.Newf(apperr.CodeValidationFailed, "不支持的输入类型。")
	}

	// OCR 与转写同样是花钱的调用，同样要记一笔。
	//
	// **绝对不能把识别出来的文字记进去**：图片里可能是身份证、病历、
	// 银行流水。这里只记它的哈希与这次调用的用量。
	s.audit.Record(ctx, aiaudit.Entry{
		UserID:      userID,
		Feature:     aiaudit.FeatureCapture,
		RunID:       part.CaptureID,
		EngineType:  "single_shot",
		ModelPolicy: policy,
		// 输入是媒体本身，指回资源 ID 就够，正文（二进制）更不能记。
		InputRefs:  []string{part.ID},
		OutputHash: aiaudit.Hash(text),
		Status:     aiaudit.StatusFor(err),
		ErrorClass: aiaudit.ClassifyError(err),
		Usage:      usage,
	})
	return text, err
}

// markPartFailed 把单个输入项标记为失败。
//
// 只有这一项进入 failed，其余输入项继续预处理；后续结构化解析由媒体门禁阻断。
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

// parallelParts 限制独立预处理的并发数；每个槽位只写一次，并等待所有调用退出。
// 取消后不再派发尚未开始的输入，运行中的 Provider 共用取消上下文。
func parallelParts(ctx context.Context, count, limit int, process func(int)) {
	var workers sync.WaitGroup
	jobs := make(chan int)
	for range limit {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for i := range jobs {
				if ctx.Err() == nil {
					process(i)
				}
			}
		}()
	}
dispatch:
	for i := range count {
		select {
		case <-ctx.Done():
			break dispatch
		case jobs <- i:
		}
	}
	close(jobs)
	workers.Wait()
}
