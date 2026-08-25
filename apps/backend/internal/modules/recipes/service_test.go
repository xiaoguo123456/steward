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

func TestDecodeIngredientsPreservesAllergens(t *testing.T) {
	raw := []byte(`[{"name":"生抽","amount":"1 勺","group":"seasoning","allergens":["大豆","小麦"]}]`)

	ingredients := decodeIngredients(raw)
	if len(ingredients) != 1 {
		t.Fatalf("食材数量应为 1，实际为 %d", len(ingredients))
	}
	if ingredients[0].Allergens == nil {
		t.Fatal("食材过敏原不应为空")
	}
	allergens := *ingredients[0].Allergens
	if len(allergens) != 2 || allergens[0] != "大豆" || allergens[1] != "小麦" {
		t.Fatalf("食材过敏原没有被保留：%v", allergens)
	}
}
