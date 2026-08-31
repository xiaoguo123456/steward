package memorymoments

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

func TestNormalizeCreateTrimsCopyAndKeepsPhotoOrder(t *testing.T) {
	descriptionCopy := "  傍晚的风很轻。  "
	description := "  湖边的自行车  "
	prepared, err := normalizeCreate(httpapi.CreateMemoryMomentRequest{
		Description: &descriptionCopy,
		Photos: []httpapi.MemoryMomentPhotoInput{
			{MediaId: "med_first", Description: &description},
			{MediaId: "med_second"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Description != "傍晚的风很轻。" {
		t.Fatalf("描述没有规范化：%+v", prepared)
	}
	if prepared.Photos[0].Description != "湖边的自行车" || prepared.Photos[1].Description != "第 2 张照片" {
		t.Fatalf("照片描述或顺序不正确：%+v", prepared.Photos)
	}
}

func TestNormalizeCreateRejectsInvalidPublishedPayload(t *testing.T) {
	longDescription := strings.Repeat("光", 501)
	cases := []httpapi.CreateMemoryMomentRequest{
		{Photos: nil},
		{Description: &longDescription, Photos: []httpapi.MemoryMomentPhotoInput{{MediaId: "med_one"}}},
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

func TestPublicationDateUsesAccountTimezone(t *testing.T) {
	now := time.Date(2026, 8, 31, 16, 30, 0, 0, time.UTC)
	got := publicationDate(now, "Asia/Shanghai")
	if got.Format("2006-01-02") != "2026-09-01" {
		t.Fatalf("发布时间没有按账号时区换算：%s", got)
	}
}
