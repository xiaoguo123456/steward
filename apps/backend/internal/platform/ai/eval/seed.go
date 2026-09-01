package eval

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/trackers"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// 用例的数据准备。
//
// 每条用例都用一个全新的用户：评测之间不能互相看到数据，
// 否则「跨用户隔离」这类用例会因为执行顺序不同而时好时坏。

var evalPhoneSeq atomic.Int64

// seedUser 造一个只属于这条用例的用户。
//
// 手机号有唯一约束，而且约束跨进程有效：同一个库上跑第二遍评测时，
// 从 0 重新计数的序号会撞上第一遍留下的用户。所以取 ID 尾部的随机段
// （前缀是 UUIDv7 的时间位，连续调用完全一样），再加计数器兜底。
func (s *Stack) seedUser(ctx context.Context) (string, error) {
	id := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("1%02d%s", evalPhoneSeq.Add(1)%100, id[len(id)-6:])

	var userID string
	err := s.DB.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		// 用户表本身受 RLS 约束，创建要走 SECURITY DEFINER 函数，
		// 与登录路径完全一致。
		return tx.QueryRow(ctx,
			`SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			id, phone, "评测用户", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		return "", fmtErr("创建评测用户", err)
	}

	// 默认清单：建任务需要它。
	err = s.DB.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := s.Lists.EnsureDefaultList(ctx, q, userID)
		return err
	})
	if err != nil {
		return "", fmtErr("创建默认清单", err)
	}
	return userID, nil
}

// seedFixtures 写入用例声明的初始数据，并返回它们的真实 ID。
func (s *Stack) seedFixtures(ctx context.Context, userID string, c Case) (seeded, error) {
	var out seeded

	for _, task := range c.Fixtures.Tasks {
		created, err := s.Objects.CreateTask(ctx, userID, httpapi.CreateTaskRequest{
			Title: task.Title,
		})
		if err != nil {
			return out, fmtErr("预置任务", err)
		}
		out.taskIDs = append(out.taskIDs, created.ID)
	}

	for _, event := range c.Fixtures.Events {
		date, err := time.Parse("2006-01-02", event.StartDate)
		if err != nil {
			return out, fmtErr("解析预置重要日日期", err)
		}
		kind := httpapi.EventKindImportantDate
		recurrence := httpapi.None
		if event.Recurrence == "yearly" {
			recurrence = httpapi.Yearly
		}
		created, err := s.Objects.CreateEvent(ctx, userID, httpapi.CreateEventRequest{
			Title: event.Title, EventKind: &kind, AllDay: true,
			StartDate: &openapi_types.Date{Time: date}, Recurrence: &recurrence,
		})
		if err != nil {
			return out, fmtErr("预置重要日", err)
		}
		out.eventIDs = append(out.eventIDs, created.ID)
	}

	if c.Fixtures.LedgerRecords != nil {
		tracker, err := s.Trackers.EnsureBuiltin(ctx, userID, trackers.BuiltinLedger)
		if err != nil {
			return out, fmtErr("预置记账项", err)
		}
		out.ledgerID = tracker.Row.ID
		for _, entry := range c.Fixtures.LedgerRecords {
			if err := s.seedLedgerRecord(ctx, userID, tracker.Row.ID, entry); err != nil {
				return out, err
			}
		}
	}

	if c.Fixtures.Memory != nil {
		if _, err := s.writeMemory(ctx, userID, *c.Fixtures.Memory); err != nil {
			return out, err
		}
	}

	// 先写再删：检验「删除后召回率为零」必须删的是真存在过的东西。
	if c.Fixtures.DeletedMemory != nil {
		id, err := s.writeMemory(ctx, userID, *c.Fixtures.DeletedMemory)
		if err != nil {
			return out, err
		}
		if _, err := s.Memory.Delete(ctx, userID, id, false); err != nil {
			return out, fmtErr("删除预置记忆", err)
		}
	}

	// 同理：阻止项要经过真实的删除路径产生，指纹才是真的。
	if c.Fixtures.RelearnBlocked != nil {
		id, err := s.writeMemory(ctx, userID, *c.Fixtures.RelearnBlocked)
		if err != nil {
			return out, err
		}
		if _, err := s.Memory.Delete(ctx, userID, id, true); err != nil {
			return out, fmtErr("写入阻止项", err)
		}
	}

	// 建议能力需要一个开着的开关，用例没显式关掉时保持默认。
	return out, nil
}

func (s *Stack) seedLedgerRecord(ctx context.Context, userID, trackerID string, entry FixtureLedger) error {
	_, err := s.Trackers.CreateRecord(ctx, userID, httpapi.CreateRecordRequest{
		TrackerId: trackerID,
		Timestamp: time.Now(),
		Values: []httpapi.RecordValue{
			{Key: "amount", NumberValue: &entry.Amount},
			{Key: "direction", TextValue: strPtr("expense")},
			{Key: "category", TextValue: strPtr(entry.Category)},
		},
	})
	if err != nil {
		return fmtErr("预置账单", err)
	}
	return nil
}

// writeMemory 走真实的确认路径写入一条记忆。
//
// 不直接插表：那样绕过了指纹计算与来源写入，评测就测不到真东西。
func (s *Stack) writeMemory(ctx context.Context, userID string, m FixtureMemory) (string, error) {
	var id string
	err := s.DB.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		created, err := s.Memory.UpsertInTx(ctx, q, userID, assistant.MemoryUpsertCommand{
			Key:         m.Key,
			Type:        "routine_preference",
			Text:        m.Text,
			Sensitivity: "normal",
			SourceRefs:  []string{"message:amsg_eval"},
		})
		id = created
		return err
	})
	if err != nil {
		return "", fmtErr("预置记忆", err)
	}
	return id, nil
}

func strPtr(v string) *string { return &v }

// marshalJSON 只在错误信息里用，失败时给出可读的兜底。
func marshalJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(raw)
}
