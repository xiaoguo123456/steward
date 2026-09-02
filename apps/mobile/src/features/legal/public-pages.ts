export const publicPagePaths = {
  legal: '/legal/',
  privacy: '/legal/privacy/',
  terms: '/legal/terms/',
  personalInformation: '/legal/personal-information/',
  thirdParties: '/legal/third-parties/',
  support: '/support/',
} as const;

export type PublicPagePath = (typeof publicPagePaths)[keyof typeof publicPagePaths];

export const publicPages = {
  privacy: { title: '隐私政策', path: publicPagePaths.privacy },
  terms: { title: '用户协议', path: publicPagePaths.terms },
  personalInformation: { title: '个人信息收集清单', path: publicPagePaths.personalInformation },
  thirdParties: { title: '第三方信息共享清单', path: publicPagePaths.thirdParties },
  support: { title: '帮助与联系我们', path: publicPagePaths.support },
} as const;

export type PublicPageKey = keyof typeof publicPages;

export function isPublicPageKey(value: string | undefined): value is PublicPageKey {
  return value !== undefined && Object.hasOwn(publicPages, value);
}

/** App 只传稳定页面键，不允许从路由参数注入任意 URL。 */
export function publicPageRoute(page: PublicPageKey) {
  return { pathname: '/public-page' as const, params: { page } };
}

/** 将固定公开路径拼到当前环境域名，避免测试包误开生产协议。 */
export function buildPublicPageUrl(baseUrl: string, path: PublicPagePath): string {
  const url = new URL(baseUrl);
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** WebView 仅承载本环境同源的法律与帮助静态页。 */
export function isAllowedPublicPageUrl(candidate: string, baseUrl: string): boolean {
  try {
    const target = new URL(candidate);
    const base = new URL(baseUrl);
    if (target.origin !== base.origin) return false;
    return target.pathname === '/legal'
      || target.pathname.startsWith('/legal/')
      || target.pathname === '/support'
      || target.pathname.startsWith('/support/');
  } catch {
    return false;
  }
}

/** H5 中唯一可以回到原生能力的公开入口。 */
export function appRouteForPublicPageUrl(
  candidate: string,
  baseUrl: string,
): '/account-deletion' | null {
  try {
    const target = new URL(candidate);
    const base = new URL(baseUrl);
    return target.origin === base.origin && target.pathname === '/account-deletion'
      ? '/account-deletion'
      : null;
  } catch {
    return null;
  }
}
