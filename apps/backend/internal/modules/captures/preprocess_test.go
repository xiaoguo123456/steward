package captures

import (
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
)

func TestMediaPreprocessStatus(t *testing.T) {
	text := "补充说明"
	tests := []struct {
		name  string
		parts []dbgen.CapturePart
		want  string
	}{
		{
			name: "全部保留媒体成功",
			parts: []dbgen.CapturePart{
				{Kind: "image", Status: "succeeded"},
				{Kind: "audio", Status: "succeeded"},
			},
		},
		{
			name: "一项媒体失败",
			parts: []dbgen.CapturePart{
				{Kind: "image", Status: "succeeded"},
				{Kind: "image", Status: "failed"},
			},
			want: "partially_failed",
		},
		{
			name: "媒体全部失败但文字可用",
			parts: []dbgen.CapturePart{
				{Kind: "text", Status: "succeeded", Text: &text},
				{Kind: "image", Status: "failed"},
			},
			want: "partially_failed",
		},
		{
			name: "媒体全部失败且没有文字",
			parts: []dbgen.CapturePart{
				{Kind: "image", Status: "failed"},
				{Kind: "audio", Status: "failed"},
			},
			want: "failed",
		},
		{
			name: "明确忽略的失败项不阻断",
			parts: []dbgen.CapturePart{
				{Kind: "image", Status: "succeeded"},
				{Kind: "image", Status: "ignored"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := mediaPreprocessStatus(tt.parts); got != tt.want {
				t.Fatalf("媒体预处理状态 = %q，期望 %q", got, tt.want)
			}
		})
	}
}
