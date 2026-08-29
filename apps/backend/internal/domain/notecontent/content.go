// Package notecontent 校验 Note 的权威正文，并生成只读纯文本投影。
package notecontent

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

const maxPlaintextRunes = 12000

// EncodePlainText 校验普通笔记正文，返回权威 JSON 与纯文本投影。
func EncodePlainText(content httpapi.NoteContentPlainText) ([]byte, string, error) {
	if content.Format != httpapi.PlainText {
		return nil, "", apperr.Validation(apperr.Field("content.format", "普通笔记只支持纯文本正文。"))
	}
	text := strings.TrimSpace(content.Text)
	if text == "" {
		return nil, "", apperr.Validation(apperr.Field("content.text", "笔记内容不能为空。"))
	}
	if utf8.RuneCountInString(text) > maxPlaintextRunes {
		return nil, "", apperr.Validation(apperr.Field("content.text", "笔记正文最多 12000 个字。"))
	}
	document, err := json.Marshal(httpapi.NoteContentPlainText{Format: httpapi.PlainText, Text: text})
	if err != nil {
		return nil, "", apperr.Internal(err)
	}
	return document, text, nil
}

// EncodeBlocksV1 校验心情日记块文档，返回权威 JSON 与确定性纯文本投影。
func EncodeBlocksV1(content httpapi.NoteContentBlocksV1) ([]byte, string, error) {
	if content.Format != httpapi.BlocksV1 || content.Version != 1 {
		return nil, "", apperr.Validation(apperr.Field("content", "日记正文版本不受支持。"))
	}
	if len(content.Blocks) == 0 || len(content.Blocks) > 500 {
		return nil, "", apperr.Validation(apperr.Field("content.blocks", "日记正文必须包含 1 至 500 个内容块。"))
	}
	seen := make(map[string]struct{}, len(content.Blocks))
	parts := make([]string, 0, len(content.Blocks))
	totalRunes := 0
	for blockIndex, block := range content.Blocks {
		id := strings.TrimSpace(block.Id)
		if id == "" {
			return nil, "", fieldError(blockIndex, "id", "内容块 ID 不能为空。")
		}
		if _, exists := seen[id]; exists {
			return nil, "", fieldError(blockIndex, "id", "内容块 ID 不能重复。")
		}
		seen[id] = struct{}{}
		if !block.Type.Valid() {
			return nil, "", fieldError(blockIndex, "type", "内容块类型不受支持。")
		}
		if block.Type == httpapi.Divider {
			if len(block.Runs) != 0 {
				return nil, "", fieldError(blockIndex, "runs", "分隔线不能包含文字。")
			}
			parts = append(parts, "")
			continue
		}
		if len(block.Runs) == 0 || len(block.Runs) > 200 {
			return nil, "", fieldError(blockIndex, "runs", "文字块必须包含 1 至 200 个文本片段。")
		}
		var builder strings.Builder
		for runIndex, run := range block.Runs {
			if run.Marks != nil && run.Marks.Link != nil {
				parsed, err := url.ParseRequestURI(*run.Marks.Link)
				if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
					return nil, "", apperr.Validation(apperr.Field(
						fmt.Sprintf("content.blocks.%d.runs.%d.marks.link", blockIndex, runIndex),
						"链接必须使用 http 或 https。"))
				}
			}
			builder.WriteString(run.Text)
		}
		text := strings.TrimSpace(builder.String())
		totalRunes += utf8.RuneCountInString(text)
		parts = append(parts, text)
	}
	plaintext := strings.TrimSpace(strings.Join(parts, "\n"))
	if plaintext == "" {
		return nil, "", apperr.Validation(apperr.Field("content.blocks", "日记正文不能为空。"))
	}
	if totalRunes > maxPlaintextRunes {
		return nil, "", apperr.Validation(apperr.Field("content.blocks", "日记正文最多 12000 个字。"))
	}
	document, err := json.Marshal(content)
	if err != nil {
		return nil, "", apperr.Internal(err)
	}
	return document, plaintext, nil
}

// Decode 还原 NoteContent 判别联合。数据库中的文档已经通过写路径校验；
// 解码失败属于存储损坏，不能静默退回另一份正文。
func Decode(document []byte) (httpapi.NoteContent, error) {
	var out httpapi.NoteContent
	if err := json.Unmarshal(document, &out); err != nil {
		return httpapi.NoteContent{}, apperr.Internal(fmt.Errorf("Note 正文文档无法解码：%w", err))
	}
	if _, err := out.ValueByDiscriminator(); err != nil {
		return httpapi.NoteContent{}, apperr.Internal(fmt.Errorf("Note 正文格式无法识别：%w", err))
	}
	return out, nil
}

// DecodeBlocksV1 还原心情日记块文档。
func DecodeBlocksV1(document []byte) (httpapi.NoteContentBlocksV1, error) {
	var out httpapi.NoteContentBlocksV1
	if err := json.Unmarshal(document, &out); err != nil {
		return httpapi.NoteContentBlocksV1{}, apperr.Internal(fmt.Errorf("心情日记正文无法解码：%w", err))
	}
	return out, nil
}

func fieldError(blockIndex int, field, message string) error {
	return apperr.Validation(apperr.Field(
		fmt.Sprintf("content.blocks.%d.%s", blockIndex, field), message))
}
