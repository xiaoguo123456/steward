import type { ComponentProps } from 'react';

import type { AppIcon } from '@/components/ui/icon';

type IconName = ComponentProps<typeof AppIcon>['name'];

export type TripAgendaItem = {
  id: string;
  time: string;
  title: string;
  meta: string;
  icon: IconName;
  color: string;
  soft: string;
};

export type TripDay = {
  id: string;
  date: string;
  weekday: string;
  label: string;
  agenda: TripAgendaItem[];
};

export type TripBooking = {
  id: string;
  title: string;
  meta: string;
  status: string;
  icon: IconName;
  color: string;
  soft: string;
};

export type TripChecklistItem = {
  id: string;
  title: string;
  meta?: string;
  completed: boolean;
};

export type TripPlan = {
  id: string;
  title: string;
  destination: string;
  dateRange: string;
  duration: string;
  status: 'upcoming' | 'completed';
  statusLabel: string;
  statusTone: 'primary' | 'neutral';
  days: TripDay[];
  bookings: TripBooking[];
  checklist: TripChecklistItem[];
};

export const tripPlans: TripPlan[] = [
  {
    id: 'shanghai-product-review',
    title: '上海出差',
    destination: '上海',
    dateRange: '8月20日—8月22日',
    duration: '3天2晚',
    status: 'upcoming',
    statusLabel: '2天后出发',
    statusTone: 'primary',
    days: [
      {
        id: 'shanghai-day-1',
        date: '8月20日',
        weekday: '周四',
        label: '第1天',
        agenda: [
          {
            id: 'g10-outbound',
            time: '08:20',
            title: '乘坐 G10 前往上海',
            meta: '北京南站 → 上海虹桥站',
            icon: 'train-outline',
            color: '#3978B8',
            soft: '#EAF4FF',
          },
          {
            id: 'hotel-check-in',
            time: '11:40',
            title: '酒店寄存行李',
            meta: '上海静安铂尔曼酒店',
            icon: 'bed-outline',
            color: '#7657C8',
            soft: '#F2EEFF',
          },
          {
            id: 'product-review',
            time: '14:00',
            title: '产品评审会议',
            meta: '南京西路 688 号 · 会议室 6A',
            icon: 'briefcase-outline',
            color: '#07865F',
            soft: '#ECFBF3',
          },
          {
            id: 'team-dinner',
            time: '18:30',
            title: '团队晚餐',
            meta: '餐厅待确认',
            icon: 'restaurant-outline',
            color: '#D56C28',
            soft: '#FFF1E7',
          },
        ],
      },
      {
        id: 'shanghai-day-2',
        date: '8月21日',
        weekday: '周五',
        label: '第2天',
        agenda: [
          {
            id: 'workshop',
            time: '09:30',
            title: '产品工作坊',
            meta: '静安办公室 · 3 小时',
            icon: 'people-outline',
            color: '#07865F',
            soft: '#ECFBF3',
          },
          {
            id: 'customer-interview',
            time: '14:30',
            title: '客户访谈',
            meta: '淮海中路 · 访谈提纲已准备',
            icon: 'chatbubbles-outline',
            color: '#3978B8',
            soft: '#EAF4FF',
          },
          {
            id: 'free-evening',
            time: '19:00',
            title: '自由安排',
            meta: '可在附近用餐或休息',
            icon: 'walk-outline',
            color: '#D56C28',
            soft: '#FFF1E7',
          },
        ],
      },
      {
        id: 'shanghai-day-3',
        date: '8月22日',
        weekday: '周六',
        label: '第3天',
        agenda: [
          {
            id: 'trip-summary',
            time: '10:00',
            title: '整理会议结论',
            meta: '酒店大堂 · 预留 60 分钟',
            icon: 'document-text-outline',
            color: '#07865F',
            soft: '#ECFBF3',
          },
          {
            id: 'g15-return',
            time: '16:10',
            title: '乘坐 G15 返回北京',
            meta: '上海虹桥站 → 北京南站',
            icon: 'train-outline',
            color: '#3978B8',
            soft: '#EAF4FF',
          },
        ],
      },
    ],
    bookings: [
      {
        id: 'rail-booking',
        title: '往返高铁',
        meta: 'G10 去程 · G15 返程',
        status: '已出票',
        icon: 'train-outline',
        color: '#3978B8',
        soft: '#EAF4FF',
      },
      {
        id: 'hotel-booking',
        title: '上海静安铂尔曼酒店',
        meta: '8月20日入住 · 2 晚',
        status: '已确认',
        icon: 'bed-outline',
        color: '#7657C8',
        soft: '#F2EEFF',
      },
    ],
    checklist: [
      { id: 'id-card', title: '身份证', completed: true },
      { id: 'laptop', title: '电脑和充电器', completed: true },
      { id: 'review-files', title: '产品评审材料', meta: '确认离线版本可打开', completed: false },
      { id: 'invoice', title: '开票信息', completed: false },
      { id: 'umbrella', title: '折叠伞', completed: false },
    ],
  },
  {
    id: 'dali-summer-trip',
    title: '大理三日游',
    destination: '大理',
    dateRange: '7月12日—7月14日',
    duration: '3天2晚',
    status: 'completed',
    statusLabel: '已结束',
    statusTone: 'neutral',
    days: [
      {
        id: 'dali-day-1',
        date: '7月12日',
        weekday: '周日',
        label: '第1天',
        agenda: [
          {
            id: 'dali-arrival',
            time: '10:40',
            title: '抵达大理',
            meta: '大理凤仪机场',
            icon: 'airplane-outline',
            color: '#3978B8',
            soft: '#EAF4FF',
          },
          {
            id: 'dali-old-town',
            time: '15:00',
            title: '大理古城散步',
            meta: '人民路 → 洋人街',
            icon: 'walk-outline',
            color: '#07865F',
            soft: '#ECFBF3',
          },
        ],
      },
    ],
    bookings: [
      {
        id: 'dali-flight',
        title: '往返机票',
        meta: '北京 ↔ 大理',
        status: '已完成',
        icon: 'airplane-outline',
        color: '#3978B8',
        soft: '#EAF4FF',
      },
    ],
    checklist: [
      { id: 'sunscreen', title: '防晒用品', completed: true },
      { id: 'camera', title: '相机和备用电池', completed: true },
    ],
  },
];

export function getTripPlan(id: string | undefined) {
  return tripPlans.find((trip) => trip.id === id) ?? tripPlans[0];
}
