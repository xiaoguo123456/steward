import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money } from '../Money';
import { adminPriceListSchema, adminPriceBodySchema, type MoneyAmount } from '@steward/admin-api-client';
import fixture from '../../../../../packages/contracts/fixtures/admin-prices.cny.json';

/**
 * 金额展示的测试。
 *
 * 守的是整条成本链路最要紧的一条约定：**缺价显示「价格缺失」，不是 ¥0.00。**
 * 显示成 0 的话，报表上的总额会系统性偏低，而且从数字上看不出偏低。
 */
describe('Money', () => {
  it('缺价时显示「价格缺失」而不是 0', () => {
    render(<Money value={{ amount: null, currency: 'CNY', status: 'pricing_missing' }} />);
    expect(screen.getByText('价格缺失')).toBeInTheDocument();
    expect(screen.queryByText(/¥0/)).not.toBeInTheDocument();
  });

  it('算好的金额正常显示', () => {
    render(<Money value={{ amount: '2.381245', currency: 'CNY', status: 'calculated' }} />);
    expect(screen.getByText('¥2.3812')).toBeInTheDocument();
  });

  it('partial 时显示金额但标出不完整', () => {
    // 那部分钱是真实花掉的，不能因为不完整就丢掉；
    // 但也不能让人以为它是全额。
    render(<Money value={{ amount: '0.01081', currency: 'CNY', status: 'partial' }} />);
    expect(screen.getByText(/0\.0108/)).toBeInTheDocument();
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });

  it('没有用量时显示破折号', () => {
    render(<Money value={{ amount: null, currency: 'CNY', status: 'no_usage' }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('值缺失时不崩', () => {
    render(<Money value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

it('官方人民币价格完整通过生成契约，旧美元字段不充当人民币', () => {
  expect(adminPriceListSchema.parse(fixture.response).data.map((row) => row.unit_price_cny)).toEqual(['0.8', '0.1', '2.7']);
  expect(adminPriceBodySchema.safeParse(fixture.request).success).toBe(true);
  const { unit_price_cny: ignored, ...legacy } = fixture.request;
  expect(adminPriceBodySchema.safeParse({ ...legacy, unit_price_usd: ignored }).success).toBe(false);
});

it('版本切换时不把旧美元金额直接换成人民币符号', () => {
  const legacy = { amount: '1', currency: 'USD', status: 'calculated' } as unknown as MoneyAmount;
  render(<Money value={legacy} />);
  expect(screen.getByText('币种待更新')).toBeInTheDocument();
  expect(screen.queryByText('¥1.0000')).not.toBeInTheDocument();
});
