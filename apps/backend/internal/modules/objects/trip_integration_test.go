package objects

import (
	"context"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
)

func TestCreateProjectInTxKeepsTripKindAndDates(t *testing.T) {
	db := shoppingTestDB(t)
	userID := seedShoppingTestUser(t, db)
	service := &Service{}
	start := time.Date(2026, 8, 29, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC)
	description := "北京\n和爸妈一起，记得带身份证"

	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := service.CreateProjectInTx(ctx, q, userID, CreateProjectCommand{
			Title:       "北京行程",
			Description: &description,
			StartDate:   &start,
			TargetDate:  &end,
			ProjectKind: "trip",
			CreatedBy:   "ai",
		})
		if err != nil {
			return err
		}
		if row.ProjectKind != "trip" {
			t.Fatalf("项目用途应为 trip，实际 %q", row.ProjectKind)
		}
		if row.StartDate == nil || row.TargetDate == nil {
			t.Fatalf("行程日期没有持久化：start=%v target=%v", row.StartDate, row.TargetDate)
		}
		if row.Description == nil || *row.Description != description {
			t.Fatalf("目的地与注意事项没有持久化：%v", row.Description)
		}
		origin, destination := "北京南", "上海虹桥"
		mode := httpapi.TransportModeTrain
		departure := time.Date(2026, 8, 29, 8, 18, 0, 0, time.UTC)
		arrival := time.Date(2026, 8, 29, 12, 32, 0, 0, time.UTC)
		event, err := service.CreateEventInTx(ctx, q, userID, CreateEventCommand{
			Title: "G1 北京南至上海虹桥", ProjectID: &row.ID,
			StartAt: &departure, EndAt: &arrival, Location: &origin,
			ItineraryDetails: &httpapi.ItineraryEventDetails{
				Kind: httpapi.ItineraryItemKindTransport, TransportMode: &mode,
				Origin: &origin, Destination: &destination,
				BookingStatus: httpapi.BookingStatusTicketed, AttachmentMediaIds: []string{},
			},
		})
		if err != nil {
			return err
		}
		mapped := MapEvent(event)
		if mapped.ItineraryDetails == nil || mapped.ItineraryDetails.Destination == nil ||
			*mapped.ItineraryDetails.Destination != destination {
			t.Fatalf("交通详情没有持久化：%+v", mapped.ItineraryDetails)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
