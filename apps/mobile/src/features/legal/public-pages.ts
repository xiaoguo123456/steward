export const publicPagePaths = {
  legal: '/legal/',
  privacy: '/legal/privacy/',
  terms: '/legal/terms/',
  personalInformation: '/legal/personal-information/',
  thirdParties: '/legal/third-parties/',
  accountDeletion: '/legal/account-deletion/',
  support: '/support/',
} as const;

export type PublicPagePath = (typeof publicPagePaths)[keyof typeof publicPagePaths];

/** 将固定公开路径拼到当前环境域名，避免测试包误开生产协议。 */
export function buildPublicPageUrl(baseUrl: string, path: PublicPagePath): string {
  const url = new URL(baseUrl);
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}
