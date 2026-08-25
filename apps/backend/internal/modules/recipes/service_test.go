package recipes

import (
	"testing"
	"time"
)

func TestDecodeStepsPreservesImageURL(t *testing.T) {
	raw := []byte(`[{"title":"第 1 步","description":"切好食材","image_url":"https://img.example/step-1.jpg"}]`)

	steps := decodeSteps(raw)
	if len(steps) != 1 {
		t.Fatalf("步骤数量应为 1，实际为 %d", len(steps))
	}
	if steps[0].ImageUrl == nil || *steps[0].ImageUrl != "https://img.example/step-1.jpg" {
		t.Fatalf("步骤图片没有被保留：%v", steps[0].ImageUrl)
	}
}

func TestSeasonalTagAtUsesChinaTimeAndFourSeasons(t *testing.T) {
	tests := []struct {
		name string
		now  time.Time
		want string
	}{
		{"二月为冬季", time.Date(2026, 2, 15, 4, 0, 0, 0, time.UTC), "season_winter"},
		{"三月至五月为春季", time.Date(2026, 3, 15, 4, 0, 0, 0, time.UTC), "season_spring"},
		{"六月至八月为夏季", time.Date(2026, 6, 15, 4, 0, 0, 0, time.UTC), "season_summer"},
		{"九月至十一月为秋季", time.Date(2026, 9, 15, 4, 0, 0, 0, time.UTC), "season_autumn"},
		{"十二月为冬季", time.Date(2026, 12, 15, 4, 0, 0, 0, time.UTC), "season_winter"},
		// UTC 仍是 2 月，中国已经进入 3 月，必须切到春季。
		{"按中国时区切季", time.Date(2026, 2, 28, 16, 30, 0, 0, time.UTC), "season_spring"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := seasonalTagAt(tt.now); got != tt.want {
				t.Fatalf("季节标签应为 %q，实际为 %q", tt.want, got)
			}
		})
	}
}
