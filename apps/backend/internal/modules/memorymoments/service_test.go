package memorymoments

import (
	"errors"
	"strings"
	"testing"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

func TestNormalizeCreateTrimsCopyAndKeepsPhotoOrder(t *testing.T) {
	title := "  海边散步  "
	story := "  傍晚的风很轻。  "
	description := "  湖边的自行车  "
	prepared, err := normalizeCreate(httpapi.CreateMemoryMomentRequest{
		OccurredOn: openapi_types.Date{Time: time.Date(2026, 8, 24, 0, 0, 0, 0, time.UTC)},
		Title:      &title, Story: &story,
		Photos: []httpapi.MemoryMomentPhotoInput{
			{MediaId: "med_first", Description: &description},
			{MediaId: "med_second"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Title != "海边散步" || prepared.Story != "傍晚的风很轻。" {
		t.Fatalf("标题或故事没有规范化：%+v", prepared)
	}
	if prepared.Photos[0].Description != "湖边的自行车" || prepared.Photos[1].Description != "第 2 张照片" {
		t.Fatalf("照片描述或顺序不正确：%+v", prepared.Photos)
	}
}

func TestNormalizeCreateRejectsInvalidPublishedPayload(t *testing.T) {
	longTitle := strings.Repeat("光", 33)
	cases := []httpapi.CreateMemoryMomentRequest{
		{Photos: nil},
		{Title: &longTitle, Photos: []httpapi.MemoryMomentPhotoInput{{MediaId: "med_one"}}},
		{Photos: []httpapi.MemoryMomentPhotoInput{{MediaId: "med_one"}, {MediaId: "med_one"}}},
	}
	for index, body := range cases {
		_, err := normalizeCreate(body)
		var domainErr *apperr.Error
		if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeValidationFailed {
			t.Fatalf("用例 %d 应返回字段校验错误，实际：%v", index, err)
		}
	}
}
