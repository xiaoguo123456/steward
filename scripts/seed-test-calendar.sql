-- 为一个已有测试账号补充当月日历验收数据。
-- 普通事项只新增缺少的同名同日数据。对本脚本早期创建的
-- evt_demo_* 重要日，会修正重复规则与类型，并软删除重复的年度条目。
-- 手工创建或其他来源的数据不会被改写。

\if :{?phone}
\else
\echo '必须通过 -v phone=手机号 指定测试账号'
\quit 2
\endif

BEGIN;

CREATE TEMP TABLE calendar_seed_target (phone text NOT NULL) ON COMMIT DROP;
INSERT INTO calendar_seed_target (phone) VALUES (:'phone');

DO $seed$
DECLARE
    target_user_id text;
    target_list_id text;
    month_start date := date_trunc('month', timezone('Asia/Shanghai', now()))::date;
    task_spec record;
    event_spec record;
    target_date date;
    start_time timestamptz;
    repaired_important_dates integer := 0;
    removed_duplicate_dates integer := 0;
BEGIN
    IF current_database() <> 'steward_test' THEN
        RAISE EXCEPTION '拒绝在非 steward_test 数据库运行：%', current_database();
    END IF;

    SELECT id INTO target_user_id
    FROM auth_find_user_by_phone((SELECT phone FROM calendar_seed_target));

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION '指定测试账号不存在，请先登录一次';
    END IF;

    PERFORM set_config('app.user_id', target_user_id, true);

    SELECT id INTO target_list_id
    FROM task_lists
    WHERE user_id = target_user_id
      AND is_default
      AND list_kind = 'tasks'
      AND archived_at IS NULL
      AND deleted_at IS NULL
    LIMIT 1;

    IF target_list_id IS NULL THEN
        target_list_id := 'lst_demo_' || substr(md5(target_user_id), 1, 20);
        INSERT INTO task_lists (
            id, user_id, name, color, position, is_default, list_kind
        ) VALUES (
            target_list_id, target_user_id, '默认清单', 'green', 0, true, 'tasks'
        ) ON CONFLICT DO NOTHING;
    END IF;

    -- 早期脚本把生日和纪念日错写成了一次性日期。如果脚本
    -- 跨月运行过多次，先只保留同名重要日中日期最新的一条。
    WITH ranked_seed_dates AS (
        SELECT
            id,
            row_number() OVER (
                PARTITION BY title
                ORDER BY start_date DESC, created_at DESC, id DESC
            ) AS position
        FROM events
        WHERE user_id = target_user_id
          AND id LIKE 'evt_demo_%'
          AND event_kind = 'important_date'
          AND title IN ('结婚纪念日', '朋友生日')
          AND start_date IS NOT NULL
          AND deleted_at IS NULL
    )
    UPDATE events AS event
    SET deleted_at = now(), updated_at = now(), version = event.version + 1
    FROM ranked_seed_dates AS ranked
    WHERE event.id = ranked.id
      AND ranked.position > 1;

    GET DIAGNOSTICS removed_duplicate_dates = ROW_COUNT;

    UPDATE events AS event
    SET
        recurrence = CASE event.title
            WHEN '结婚纪念日' THEN 'yearly'
            WHEN '朋友生日' THEN 'yearly'
            ELSE 'none'
        END,
        important_date_kind = CASE event.title
            WHEN '结婚纪念日' THEN 'anniversary'
            WHEN '朋友生日' THEN 'birthday'
            ELSE 'expiry'
        END,
        original_month_day = CASE
            WHEN event.title IN ('结婚纪念日', '朋友生日')
                THEN to_char(event.start_date, 'MM-DD')
            ELSE NULL
        END,
        updated_at = now(),
        version = event.version + 1
    WHERE event.user_id = target_user_id
      AND event.id LIKE 'evt_demo_%'
      AND event.event_kind = 'important_date'
      AND event.title IN ('结婚纪念日', '朋友生日', '房租到期')
      AND event.start_date IS NOT NULL
      AND event.deleted_at IS NULL
      AND (
          event.recurrence IS DISTINCT FROM CASE event.title
              WHEN '结婚纪念日' THEN 'yearly'
              WHEN '朋友生日' THEN 'yearly'
              ELSE 'none'
          END
          OR event.important_date_kind IS DISTINCT FROM CASE event.title
              WHEN '结婚纪念日' THEN 'anniversary'
              WHEN '朋友生日' THEN 'birthday'
              ELSE 'expiry'
          END
          OR event.original_month_day IS DISTINCT FROM CASE
              WHEN event.title IN ('结婚纪念日', '朋友生日')
                  THEN to_char(event.start_date, 'MM-DD')
              ELSE NULL
          END
      );

    GET DIAGNOSTICS repaired_important_dates = ROW_COUNT;

    FOR task_spec IN
        SELECT * FROM (VALUES
            (3,  '洗衣服',         'normal'),
            (4,  '准备评审材料',   'high'),
            (7,  '整理差旅报销',   'normal'),
            (9,  '采购旅行用品',   'normal'),
            (11, '更新产品文档',   'high'),
            (14, '预约年度体检',   'normal'),
            (18, '阅读计划',       'normal'),
            (20, '归还图书',       'normal'),
            (23, '周末大扫除',     'normal'),
            (26, '打包出差行李',   'high'),
            (28, '整理旅行照片',   'low'),
            (30, '完成月度复盘',   'normal')
        ) AS value(day_of_month, title, priority)
    LOOP
        target_date := month_start + (task_spec.day_of_month - 1);
        INSERT INTO tasks (
            id, user_id, title, status, priority, due_date, due_timezone,
            list_id, reminders, created_by, provenance_refs
        )
        SELECT
            'tsk_demo_' || substr(md5(target_user_id || task_spec.title || target_date::text), 1, 20),
            target_user_id, task_spec.title, 'todo', task_spec.priority,
            target_date, 'Asia/Shanghai', target_list_id,
            '[]'::jsonb, 'user', '[]'::jsonb
        WHERE NOT EXISTS (
            SELECT 1 FROM tasks
            WHERE user_id = target_user_id
              AND title = task_spec.title
              AND due_date = target_date
              AND deleted_at IS NULL
        );
    END LOOP;

    FOR task_spec IN
        SELECT * FROM (VALUES
            ('整理旧照片',       'normal'),
            ('读完收藏文章',     'low'),
            ('更新家庭物品清单', 'high')
        ) AS value(title, priority)
    LOOP
        INSERT INTO tasks (
            id, user_id, title, status, priority, list_id,
            reminders, created_by, provenance_refs
        )
        SELECT
            'tsk_demo_' || substr(md5(target_user_id || 'anytime' || task_spec.title), 1, 20),
            target_user_id, task_spec.title, 'todo', task_spec.priority,
            target_list_id, '[]'::jsonb, 'user', '[]'::jsonb
        WHERE NOT EXISTS (
            SELECT 1 FROM tasks
            WHERE user_id = target_user_id
              AND title = task_spec.title
              AND due_date IS NULL
              AND due_at IS NULL
              AND scheduled_start_at IS NULL
              AND focus_date IS NULL
              AND deleted_at IS NULL
        );
    END LOOP;

    FOR event_spec IN
        SELECT * FROM (VALUES
            (2,  '产品周报',     'schedule',       9,  '线上会议', NULL,          'none'),
            (3,  '团队周会',     'schedule',       10, '一号会议室', NULL,          'none'),
            (4,  '设计评审',     'schedule',       14, '二号会议室', NULL,          'none'),
            (5,  '上海出差',     'schedule',       8,  '虹桥站',     NULL,          'none'),
            (6,  '客户回访',     'schedule',       15, '线上会议', NULL,          'none'),
            (7,  '健身课',       'schedule',       19, '社区健身房', NULL,          'none'),
            (9,  '朋友聚餐',     'schedule',       18, '静安寺',       NULL,          'none'),
            (10, '牙医复诊',     'schedule',       11, '口腔门诊',     NULL,          'none'),
            (12, '版本发布',     'schedule',       16, '线上',         NULL,          'none'),
            (13, '财务对账',     'schedule',       10, '办公室',       NULL,          'none'),
            (14, '结婚纪念日',   'important_date', 0,  '',             'anniversary', 'yearly'),
            (15, '参观展览',     'schedule',       14, '美术馆',       NULL,          'none'),
            (17, '亲子活动',     'schedule',       10, '城市公园',     NULL,          'none'),
            (19, '读书会',       'schedule',       19, '图书馆',       NULL,          'none'),
            (21, '朋友生日',     'important_date', 0,  '',             'birthday',    'yearly'),
            (22, '周末晚餐',     'schedule',       18, '滨寿司',       NULL,          'none'),
            (24, '房租到期',     'important_date', 0,  '',             'expiry',      'none'),
            (25, '项目启动会',   'schedule',       9,  '三号会议室', NULL,          'none'),
            (27, '出差返程',     'schedule',       17, '虹桥站',       NULL,          'none'),
            (28, '家庭聚餐',     'schedule',       18, '家',           NULL,          'none'),
            (29, '周末露营',     'schedule',       9,  '郊野公园',     NULL,          'none')
        ) AS value(
            day_of_month, title, event_kind, hour_of_day, location,
            important_date_kind, recurrence
        )
    LOOP
        target_date := month_start + (event_spec.day_of_month - 1);

        IF event_spec.event_kind = 'important_date' THEN
            INSERT INTO events (
                id, user_id, title, event_kind, all_day, start_date, timezone,
                participants, reminders, recurrence, original_month_day,
                important_date_kind, created_by, provenance_refs
            )
            SELECT
                'evt_demo_' || substr(md5(target_user_id || event_spec.title || target_date::text), 1, 20),
                target_user_id, event_spec.title, event_spec.event_kind, true,
                target_date, 'Asia/Shanghai', '[]'::jsonb, '[]'::jsonb,
                event_spec.recurrence,
                CASE WHEN event_spec.recurrence = 'yearly'
                    THEN to_char(target_date, 'MM-DD') ELSE NULL END,
                event_spec.important_date_kind, 'user', '[]'::jsonb
            WHERE NOT EXISTS (
                SELECT 1 FROM events
                WHERE user_id = target_user_id
                  AND title = event_spec.title
                  AND (
                      (event_spec.recurrence = 'yearly' AND recurrence = 'yearly')
                      OR (event_spec.recurrence <> 'yearly' AND start_date = target_date)
                  )
                  AND deleted_at IS NULL
            );
        ELSE
            start_time := (target_date + make_interval(hours => event_spec.hour_of_day))
                AT TIME ZONE 'Asia/Shanghai';
            INSERT INTO events (
                id, user_id, title, event_kind, all_day, start_at, end_at,
                timezone, location, participants, reminders, recurrence,
                created_by, provenance_refs
            )
            SELECT
                'evt_demo_' || substr(md5(target_user_id || event_spec.title || target_date::text), 1, 20),
                target_user_id, event_spec.title, event_spec.event_kind, false,
                start_time, start_time + interval '1 hour', 'Asia/Shanghai',
                nullif(event_spec.location, ''), '[]'::jsonb, '[]'::jsonb,
                'none', 'user', '[]'::jsonb
            WHERE NOT EXISTS (
                SELECT 1 FROM events
                WHERE user_id = target_user_id
                  AND title = event_spec.title
                  AND start_at >= target_date AT TIME ZONE 'Asia/Shanghai'
                  AND start_at < (target_date + 1) AT TIME ZONE 'Asia/Shanghai'
                  AND deleted_at IS NULL
            );
        END IF;
    END LOOP;

    RAISE NOTICE '已修正重要日 % 条，软删除重复年度条目 % 条',
        repaired_important_dates, removed_duplicate_dates;
END
$seed$;

COMMIT;
