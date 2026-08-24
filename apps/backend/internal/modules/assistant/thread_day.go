package assistant

import (
	"context"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// conversationDayBounds 返回用户当地自然日的左闭右开边界。
// 使用 AddDate 而不是固定 24 小时，避免夏令时切换日算错。
func conversationDayBounds(now time.Time, timezone string) (start, end time.Time) {
	loc := timeutil.LoadLocation(timezone)
	start = timeutil.DayOf(now, loc).Start
	return start, start.AddDate(0, 0, 1)
}

func (s *Service) currentConversationDay(ctx context.Context, q *dbgen.Queries,
	userID string) (start, end time.Time, err error) {
	timezone, err := s.users.Timezone(ctx, q, userID)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	now := time.Now
	if s.now != nil {
		now = s.now
	}
	start, end = conversationDayBounds(now(), timezone)
	return start, end, nil
}
