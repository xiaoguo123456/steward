package openai

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
)

// TestLiveLedgerMedia 使用外部虚构素材验证真实识别与结构化解析，不保存媒体或用户账单。
func TestLiveLedgerMedia(t *testing.T) {
	dir := os.Getenv("STEWARD_AI_LIVE_LEDGER_DIR")
	if dir == "" {
		t.Skip("需显式提供虚构记账素材目录")
	}
	_ = config.LoadForTest()
	p, err := New(Config{BaseURL: os.Getenv("STEWARD_AI_BASE_URL"), APIKey: os.Getenv("STEWARD_AI_API_KEY"), ParseModel: os.Getenv("STEWARD_AI_MODEL_PARSE"), VisionModel: os.Getenv("STEWARD_AI_MODEL_VISION"), TranscribeModel: os.Getenv("STEWARD_AI_MODEL_TRANSCRIBE"), TranscribeProtocol: os.Getenv("STEWARD_AI_TRANSCRIBE_PROTOCOL"), ThinkingMode: "disabled", Timeout: 45 * time.Second, MaxOutputTokens: 2500, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	ledger := ai.TrackerRef{ID: "ledger_test", Name: "记账", Fields: []ai.TrackerFieldRef{
		{Key: "amount", Label: "金额", Type: "currency", Unit: "元", Required: true},
		{Key: "direction", Label: "收支", Type: "text", Required: true},
		{Key: "category", Label: "分类", Type: "text", Required: true},
		{Key: "merchant", Label: "商家", Type: "text"},
		{Key: "payment_method", Label: "支付方式", Type: "text"},
	}}
	now := time.Date(2026, 9, 8, 13, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		file, mime, direction string
		amount                float64
	}{
		{"receipt.png", "image/png", "expense", 28},
		{"expense.wav", "audio/wav", "expense", 35.6},
		{"income.wav", "audio/wav", "income", 128},
	} {
		t.Run(tc.file, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(dir, tc.file))
			if err != nil {
				t.Fatal(err)
			}
			started := time.Now()
			input := ai.MediaInput{ContentType: tc.mime, Data: data}
			var extracted string
			if tc.mime == "image/png" {
				extracted, _, err = p.ExtractFromImage(t.Context(), input)
			} else {
				extracted, _, err = p.Transcribe(t.Context(), input)
			}
			if err != nil {
				t.Fatalf("媒体提取失败：%v", err)
			}
			result, err := p.ParseCapture(t.Context(), ai.CaptureParseRequest{Now: now, Timezone: "Asia/Shanghai", Trackers: []ai.TrackerRef{ledger}, Parts: []ai.InputPart{{ID: "intent", Kind: "text", Text: "请将本次输入整理为需要我确认的记账记录。"}, {ID: "media", Kind: "text", Text: extracted}}})
			if err != nil || len(result.Candidates) != 1 {
				t.Fatalf("应生成一笔记账候选：%v", err)
			}
			c := result.Candidates[0]
			if c.Type != "record" || c.TrackerID != ledger.ID || len(c.Missing) != 0 {
				t.Fatal("记账类型、账本或必填字段不正确")
			}
			amountOK, directionOK := false, false
			for _, v := range c.RecordValues {
				if v.Key == "amount" {
					amountOK = v.Number != nil && *v.Number == tc.amount
				}
				if v.Key == "direction" {
					directionOK = v.Text == tc.direction
				}
			}
			if !amountOK || !directionOK {
				t.Fatal("金额或收支方向错误")
			}
			if tc.file == "receipt.png" && (c.Timestamp == nil || !c.Timestamp.Equal(time.Date(2026, 9, 8, 4, 30, 0, 0, time.UTC))) {
				t.Fatal("没有保留票据交易时间")
			}
			t.Logf("金额、收支及时间验证通过，识别加解析耗时 %.2f 秒", time.Since(started).Seconds())
		})
	}
}
