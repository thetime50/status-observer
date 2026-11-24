import { bind } from '../../shared/expand.mjs'
import { pstNav, tunnelInstances } from '../../shared/sites.mjs'

const pst = { id: 'pst', baseurl: 'https://pst.thetime50.com' }
const tunnel = {
  id: 'cloudflare-tunnel',
  baseurl: 'https://collectables-templates-pmc-boom.trycloudflare.com',
}

export default {
  endpoint: {
    repo: 'UptimeFlare-Cloud-DSH',
    branch: 'Cloud-DSH',
    title: 'Cloud-DSH',
  },
  monitors: [bind(pstNav, pst), bind(tunnelInstances, tunnel)],
}
