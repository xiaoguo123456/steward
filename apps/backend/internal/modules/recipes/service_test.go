package recipes

import "testing"

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
