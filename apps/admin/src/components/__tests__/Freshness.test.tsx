import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Freshness } from '../Freshness';

/**
 * 数据新鲜度的测试。
 *
 * **不标出来的话，一个还没聚合的今天会被读成「今天没人用」**——
 * 那是最容易让人做出错误判断的一种错。
 */
describe('Freshness', () => {
  it('数据新鲜时显示截止时间', () => {
    render(
      <Freshness value={{ data_as_of: '2026-08-20T13:00:00Z', aggregation_status: 'fresh' }} />,
    );
    expect(screen.getByText(/数据截至/)).toBeInTheDocument();
  });

  it('数据陈旧时明确警告', () => {
    render(
      <Freshness value={{ data_as_of: '2026-08-18T13:00:00Z', aggregation_status: 'stale' }} />,
    );
    expect(screen.getByText(/数据可能已经过时/)).toBeInTheDocument();
  });

  it('还没聚合过时说明这不等于没人用', () => {
    render(<Freshness value={{ data_as_of: null, aggregation_status: 'pending' }} />);
    expect(screen.getByText(/聚合还没有跑过/)).toBeInTheDocument();
    expect(screen.getByText(/不等于「没有用户在用」/)).toBeInTheDocument();
  });

  it('聚合失败时说明看到的是哪一份数据', () => {
    render(
      <Freshness value={{ data_as_of: '2026-08-19T13:00:00Z', aggregation_status: 'failed' }} />,
    );
    expect(screen.getByText(/上一次聚合失败/)).toBeInTheDocument();
  });
});
