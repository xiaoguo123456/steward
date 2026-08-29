package notecontent

import (
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
)

func TestEncodeBlocksV1GeneratesDeterministicPlaintext(t *testing.T) {
	document := httpapi.NoteContentBlocksV1{
		Format:  httpapi.BlocksV1,
		Version: httpapi.N1,
		Blocks: []httpapi.NoteBlock{
			{Id: "blk_1", Type: httpapi.Heading2, Runs: []httpapi.NoteTextRun{{Text: " 今天 "}}},
			{Id: "blk_2", Type: httpapi.Paragraph, Runs: []httpapi.NoteTextRun{{Text: "散步时看见了晚霞。"}}},
			{Id: "blk_3", Type: httpapi.Divider, Runs: []httpapi.NoteTextRun{}},
			{Id: "blk_4", Type: httpapi.Quote, Runs: []httpapi.NoteTextRun{{Text: "慢一点也没关系。"}}},
		},
	}

	encoded, plaintext, err := EncodeBlocksV1(document)
	if err != nil {
		t.Fatalf("合法块文档不应失败：%v", err)
	}
	if len(encoded) == 0 {
		t.Fatal("应当返回权威 JSON 文档")
	}
	if want := "今天\n散步时看见了晚霞。\n\n慢一点也没关系。"; plaintext != want {
		t.Fatalf("纯文本投影 = %q，期望 %q", plaintext, want)
	}
}

func TestEncodeBlocksV1RejectsDuplicateBlockID(t *testing.T) {
	_, _, err := EncodeBlocksV1(httpapi.NoteContentBlocksV1{
		Format: httpapi.BlocksV1, Version: httpapi.N1,
		Blocks: []httpapi.NoteBlock{
			{Id: "same", Type: httpapi.Paragraph, Runs: []httpapi.NoteTextRun{{Text: "第一段"}}},
			{Id: "same", Type: httpapi.Paragraph, Runs: []httpapi.NoteTextRun{{Text: "第二段"}}},
		},
	})
	if err == nil {
		t.Fatal("重复块 ID 必须被拒绝")
	}
}

func TestEncodeBlocksV1RejectsUnsafeLink(t *testing.T) {
	link := "javascript:alert(1)"
	_, _, err := EncodeBlocksV1(httpapi.NoteContentBlocksV1{
		Format: httpapi.BlocksV1, Version: httpapi.N1,
		Blocks: []httpapi.NoteBlock{{
			Id: "blk_1", Type: httpapi.Paragraph,
			Runs: []httpapi.NoteTextRun{{Text: "链接", Marks: &httpapi.NoteTextMark{Link: &link}}},
		}},
	})
	if err == nil {
		t.Fatal("非 http/https 链接必须被拒绝")
	}
}
