/**
 * 后台 API Client。
 *
 * **URL、参数、DTO、错误码与枚举全部由 Admin OpenAPI 生成**，
 * 前端不手写任何一处网络细节——手写的那份迟早和契约漂开，
 * 而漂开的时候没有任何东西会报错。
 */
export * from './generated/admin-auth/admin-auth';
export * from './generated/admin-dashboard/admin-dashboard';
export * from './generated/admin-users/admin-users';
export * from './generated/admin-usage/admin-usage';
export * from './generated/admin-costs/admin-costs';
export * from './generated/admin-ops/admin-ops';
export * from './generated/admin-audit/admin-audit';
export * from './generated/model';
export {
  AdminApiError,
  onAdminSessionExpired,
  setCsrfToken,
  clearCsrfToken,
  getCsrfToken,
  unwrap,
} from './http/fetcher';

// 认证边界使用从同一 OpenAPI 生成的运行时校验器。
export { AdminLoginBody as adminLoginBodySchema, AdminLoginResponse as adminLoginResponseSchema, AdminGetSessionResponse as adminSessionResponseSchema, AdminRequestPhoneCodeBody as adminPhoneCodeBodySchema, AdminRequestPhoneCodeResponse as adminPhoneCodeResponseSchema, AdminResetPasswordBody as adminResetPasswordBodySchema, AdminResetPasswordResponse as adminResetPasswordResponseSchema } from './generated/admin-auth/admin-auth.zod';

// 价格配置按人民币契约校验，禁止把旧币种字段当作新价格。
export { AdminListAIPricesResponse as adminPriceListSchema, AdminCreateAIPriceBody as adminPriceBodySchema } from './generated/admin-costs/admin-costs.zod';
