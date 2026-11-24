/** 站点带检测。关键字、期望状态码都可以不写。 */
export const pstNav = {
  name: 'PST-nav-menu',
  path: '/api/nav-menu',
  method: 'GET',
  keyword: 'menus',
  expectedCodes: [200],
  timeoutMs: 10000,
}

export const tunnelInstances = {
  name: 'Cloud-DSH-tunnel',
  path: '/manage/api/instances',
  method: 'GET',
  keyword: '[',
  expectedCodes: [200],
  timeoutMs: 10000,
}

export const channelProbe = {
  name: 'channel-probe',
  path: '/health',
  method: 'GET',
  timeoutMs: 10000,
}
