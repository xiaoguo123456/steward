import { CursorPager, useCursorPages } from '@/components/CursorPager';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  AdminApiError,
  adminResumeUser,
  adminRevokeUserSessions,
  adminSetUserBudget,
  adminSuspendUser,
  useAdminGetUser,
  useAdminGetUserAdminActions,
  useAdminGetUserCosts,
  useAdminGetUserOperations,
  useAdminGetUserUsage,
  unwrap,
} from '@steward/admin-api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { Money } from '@/components/Money';
import { PageState } from '@/components/PageState';

type ActionKind = 'suspend' | 'resume' | 'revoke' | 'budget';

const reasonOptions = [
  { value: 'abuse_prevention', label: '滥用防护' },
  { value: 'payment_issue', label: '费用问题' },
  { value: 'user_request', label: '用户申请' },
  { value: 'security_incident', label: '安全事件' },
  { value: 'support_investigation', label: '客服排查' },
  { value: 'other', label: '其他' },
];

export function UserDetailPage() {
  const { userId = '' } = useParams();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ActionKind | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const openAction = (next: ActionKind) => {
    attempt.current = null;
    form.resetFields();
    if (next === 'budget') form.setFieldsValue(user?.ai_budget ?? {});
    setAction(next);
  };

  const detail = useAdminGetUser(userId);
  const user = unwrap(detail.data)?.data;

  const submit = async (values: Record<string, unknown>) => {
    if (!user || !action || submittingRef.current) return;
    const base = {
      expected_version: user.version,
      reason_code: values.reason_code as never,
      reason_text: values.reason_text as string,
    };

    const body = JSON.stringify({ action, userId, base, daily_calls: values.daily_calls ?? null, monthly_calls: values.monthly_calls ?? null });
    // 结果未知时保留同一请求的幂等键；修改参数或重新确认版本后才建立新尝试。
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    const key = attempt.current.key;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (action === 'suspend') {
        await adminSuspendUser(userId, base, { headers: { 'Idempotency-Key': key } });
      } else if (action === 'resume') {
        await adminResumeUser(userId, base, { headers: { 'Idempotency-Key': key } });
      } else if (action === 'revoke') {
        await adminRevokeUserSessions(userId, base, { headers: { 'Idempotency-Key': key } });
      } else {
        await adminSetUserBudget(
          userId,
          {
            ...base,
            daily_calls: (values.daily_calls as number) ?? null,
            monthly_calls: (values.monthly_calls as number) ?? null,
          },
          { headers: { 'Idempotency-Key': key } },
        );
      }
      attempt.current = null;
      message.success('操作已完成');
      setAction(null);
      form.resetFields();
      // 使详情与已缓存的统计重新查询，后台快照仍按其更新时间展示。
      await queryClient.invalidateQueries();
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'ADMIN_VERSION_CONFLICT') {
        // 版本冲突要**先刷新再让人重新确认**，不能直接重试：
        // 数据已经被别人改过，用户看到的前提已经不成立了。
        message.warning('这条数据刚被改动过，已为你刷新，请确认后重试。');
        attempt.current = null;
        await detail.refetch();
        return;
      }
      message.error(err instanceof AdminApiError ? err.message : '请求结果未确认，请保留当前表单重试。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        用户详情
      </Typography.Title>

      <PageState loading={detail.isPending} error={detail.error} onRetry={() => void detail.refetch()}>
        {user ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {user.account_status === 'suspended' ? (
              <Alert type="warning" showIcon message="该用户当前处于暂停状态" />
            ) : null}

            <Card
              title="概览"
              extra={
                <Space>
                  {user.account_status === 'active' ? (
                    <Button danger onClick={() => openAction('suspend')}>
                      暂停
                    </Button>
                  ) : (
                    <Button type="primary" onClick={() => openAction('resume')}>
                      恢复
                    </Button>
                  )}
                  <Button onClick={() => openAction('revoke')}>撤销会话</Button>
                  <Button onClick={() => openAction('budget')}>设置预算</Button>
                </Space>
              }
            >
              <Descriptions column={3} size="small">
                <Descriptions.Item label="名称">{user.display_name || '—'}</Descriptions.Item>
                <Descriptions.Item label="注册时间">{new Date(user.created_at).toLocaleString('zh-CN')}</Descriptions.Item>
                <Descriptions.Item label="最近活跃">{user.last_active_at ? new Date(user.last_active_at).toLocaleDateString('zh-CN') : '—'}</Descriptions.Item>
                <Descriptions.Item label="每日 AI 上限">{user.ai_budget?.daily_calls ?? '未设置用户上限'}</Descriptions.Item>
                <Descriptions.Item label="每月 AI 上限">{user.ai_budget?.monthly_calls ?? '未设置用户上限'}</Descriptions.Item>
                <Descriptions.Item label="用户 ID">
                  <Typography.Text copyable style={{ fontSize: 12 }}>
                    {user.id}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="手机号">{user.masked_phone}</Descriptions.Item>
                <Descriptions.Item label="状态">
                  {user.account_status === 'suspended' ? (
                    <Tag color="red">已暂停</Tag>
                  ) : (
                    <Tag color="green">正常</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="时区">{user.timezone}</Descriptions.Item>
                <Descriptions.Item label="初始化">
                  {user.initialized ? '已完成' : '未完成'}
                </Descriptions.Item>
                <Descriptions.Item label="有效会话">{user.active_sessions ?? 0}</Descriptions.Item>
                <Descriptions.Item label="任务">{user.counts.tasks}</Descriptions.Item>
                <Descriptions.Item label="日程">{user.counts.events}</Descriptions.Item>
                <Descriptions.Item label="笔记">{user.counts.notes}</Descriptions.Item>
                <Descriptions.Item label="Capture">{user.counts.captures}</Descriptions.Item>
                <Descriptions.Item label="会话">{user.counts.assistant_threads}</Descriptions.Item>
                <Descriptions.Item label="项目">{user.counts.projects}</Descriptions.Item>
              </Descriptions>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                后台只显示数量与状态，不显示笔记、消息、记忆或媒体的内容。
              </Typography.Text>
            </Card>

            <Tabs
              items={[
                { key: 'usage', label: '使用情况', children: <UsageTab userId={userId} /> },
                { key: 'costs', label: 'AI 成本', children: <CostsTab userId={userId} /> },
                { key: 'ops', label: '处理记录', children: <OperationsTab userId={userId} /> },
                { key: 'actions', label: '管理记录', children: <ActionsTab userId={userId} /> },
              ]}
            />
          </Space>
        ) : null}
      </PageState>

      <Modal
        open={action !== null}
        confirmLoading={submitting}
        cancelButtonProps={{ disabled: submitting }}
        closable={!submitting}
        keyboard={!submitting}
        maskClosable={!submitting}
        title={
          action === 'suspend'
            ? '暂停用户'
            : action === 'resume'
              ? '恢复用户'
              : action === 'revoke'
                ? '撤销全部会话'
                : '设置 AI 预算'
        }
        onCancel={() => {
          if (submittingRef.current) return;
          attempt.current = null;
          setAction(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="确认执行"
      >
        {/* 确认框要说清楚：对谁、有什么影响、当前版本是多少。
            只写「确定吗」的话，人只能凭记忆判断自己点的是不是对的那一行。 */}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`目标：${user?.masked_phone ?? ''}（${userId}）`}
          description={
            action === 'suspend'
              ? '暂停后该用户无法登录，并会立即撤销他全部登录会话。'
              : action === 'resume'
                ? '恢复后该用户可以重新登录。旧会话不会一并恢复，需要他重新登录。'
                : action === 'revoke'
                  ? '该用户全部登录设备会被登出，需要重新登录。账号状态不变。'
                  : '预算按调用次数计。不会因此替用户打开他自己关掉的 AI 开关。'
          }
        />
        <Form form={form} layout="vertical" onFinish={submit} disabled={submitting}>
          <Form.Item
            name="reason_code"
            label="处置原因"
            rules={[{ required: true, message: '请选择原因' }]}
          >
            <Select options={reasonOptions} />
          </Form.Item>
          <Form.Item
            name="reason_text"
            label="具体说明"
            rules={[{ required: true, min: 4, message: '请写清楚具体原因，至少四个字' }]}
            extra="这条说明会长期保留。请写处置依据，不要抄用户的原话。"
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
          {action === 'budget' ? (
            <>
              <Form.Item name="daily_calls" label="每日调用上限" extra="留空表示不限">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="monthly_calls" label="每月调用上限" extra="留空表示不限">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
    </Space>
  );
}

function UsageTab({ userId }: { userId: string }) {
  const query = useAdminGetUserUsage(userId);
  const rows = unwrap(query.data)?.data ?? [];
  return (
    <PageState loading={query.isPending} error={query.error} onRetry={() => void query.refetch()} empty={rows.length === 0}>
      <Table
        rowKey="date"
        size="small"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '日期', dataIndex: 'date' },
          { title: '活跃', dataIndex: 'active', render: (v: boolean) => (v ? '是' : '否') },
          { title: 'Capture 提交', dataIndex: 'capture_submitted' },
          { title: 'Capture 确认', dataIndex: 'capture_confirmed' },
          { title: '任务完成', dataIndex: 'task_completed' },
          { title: 'Assistant 轮次', dataIndex: 'assistant_turns' },
        ]}
      />
    </PageState>
  );
}

function CostsTab({ userId }: { userId: string }) {
  const query = useAdminGetUserCosts(userId);
  const rows = unwrap(query.data)?.data ?? [];
  return (
    <PageState loading={query.isPending} error={query.error} onRetry={() => void query.refetch()} empty={rows.length === 0}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Table
          rowKey={(r) => `${r.date}-${r.feature}-${r.model}`}
          size="small"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '日期', dataIndex: 'date' },
            { title: '功能', dataIndex: 'feature' },
            { title: '模型', dataIndex: 'model', render: (v: string) => v || '—' },
            { title: '调用', dataIndex: 'calls' },
            { title: '输入 token', dataIndex: 'input_tokens' },
            { title: '输出 token', dataIndex: 'output_tokens' },
            { title: '成本', render: (_: unknown, r) => <Money value={r.cost} /> },
          ]}
        />
        <Typography.Text>
          合计：<Money value={unwrap(query.data)?.total} />
        </Typography.Text>
      </Space>
    </PageState>
  );
}

function OperationsTab({ userId }: { userId: string }) {
  const paging = useCursorPages();
  const query = useAdminGetUserOperations(userId, { limit: 20, cursor: paging.cursor });
  const rows = unwrap(query.data)?.data ?? [];
  return (
    <PageState loading={query.isPending} error={query.error} onRetry={() => void query.refetch()} empty={rows.length === 0}>
      <div><Table
        rowKey="id"
        size="small"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '类型', dataIndex: 'kind' },
          { title: '状态', dataIndex: 'status' },
          {
            title: '错误码',
            dataIndex: 'error_code',
            render: (v?: string | null) => v ?? '—',
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            render: (v: string) => new Date(v).toLocaleString('zh-CN'),
          },
        ]}
      />
      <CursorPager paging={paging} nextCursor={unwrap(query.data)?.page.next_cursor} loading={query.isFetching} /></div>
    </PageState>
  );
}

function ActionsTab({ userId }: { userId: string }) {
  const paging = useCursorPages();
  const query = useAdminGetUserAdminActions(userId, { limit: 20, cursor: paging.cursor });
  const rows = unwrap(query.data)?.data ?? [];
  return (
    <PageState
      loading={query.isPending}
      error={query.error} onRetry={() => void query.refetch()}
      empty={rows.length === 0}
      emptyText="这个用户还没有被执行过管理操作"
    >
      <div><Table
        rowKey="id"
        size="small"
        dataSource={rows}
        pagination={false}
        columns={[
          {
            title: '时间',
            dataIndex: 'occurred_at',
            render: (v: string) => new Date(v).toLocaleString('zh-CN'),
          },
          { title: '操作', dataIndex: 'action' },
          { title: '结果', dataIndex: 'outcome' },
          { title: '原因', dataIndex: 'reason_code', render: (v?: string | null) => v ?? '—' },
          { title: '说明', dataIndex: 'reason_text', render: (v?: string | null) => v ?? '—' },
        ]}
      />
      <CursorPager paging={paging} nextCursor={unwrap(query.data)?.page.next_cursor} loading={query.isFetching} /></div>
    </PageState>
  );
}
