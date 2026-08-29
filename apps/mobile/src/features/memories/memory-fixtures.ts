import type { MemoryMoment } from './memory-model';

export const memoryPrototypeFixtures: MemoryMoment[] = [
  {
    id: 'memory-demo-seaside',
    date: '2026-08-24',
    title: '海边的风比想象中温柔',
    story: '沿着海边慢慢走，回来时天刚好暗。',
    origin: 'demo',
    photos: [
      {
        id: 'photo-seaside-bike',
        source: require('../../../assets/memories/seaside-bike.jpg'),
        description: '海边树荫下停着一辆自行车，远处是蓝色海面和群山',
      },
      {
        id: 'photo-seaside-reading',
        source: require('../../../assets/memories/seaside-reading.jpg'),
        description: '临海窗边的木桌上放着书和冰咖啡',
      },
      {
        id: 'photo-seaside-evening',
        source: require('../../../assets/memories/seaside-evening.jpg'),
        description: '蓝调时刻的海滨步道亮起路灯',
      },
      {
        id: 'photo-beach-footprints',
        source: require('../../../assets/memories/beach-footprints.jpg'),
        description: '傍晚沙滩上的脚印和海浪',
      },
    ],
  },
  {
    id: 'memory-demo-dinner',
    date: '2026-08-17',
    title: '和朋友们的晚餐',
    story: '没聊什么大事，却一直坐到了很晚。',
    origin: 'demo',
    photos: [
      {
        id: 'photo-friends-dinner',
        source: require('../../../assets/memories/friends-dinner.jpg'),
        description: '朋友们围坐在木桌旁分享家常菜',
      },
      {
        id: 'photo-city-sunset',
        source: require('../../../assets/memories/city-sunset.jpg'),
        description: '夕阳穿过行道树照在城市人行道上',
      },
    ],
  },
  {
    id: 'memory-demo-night',
    date: '2026-07-30',
    title: '很普通，也值得记住',
    story: '下班后绕去了江边，看了一会儿城市的灯。',
    origin: 'demo',
    photos: [
      {
        id: 'photo-city-night',
        source: require('../../../assets/memories/city-night.jpg'),
        description: '夜晚城市天际线和水面灯光倒影',
      },
    ],
  },
];
