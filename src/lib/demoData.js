// Demo users — mirrors 003_seed.sql
const CO = 'SunPower Solar'

export const DEMO_USERS = [
  { id: 'u-vp1',  name: 'Jordan Voss',   email: 'vp@solarcrm.dev',    role: 'vp',       company_name: CO, manager_id: null,   director_id: null,   vp_id: null },
  { id: 'u-dir1', name: 'Rachel Kim',    email: 'dir1@solarcrm.dev',  role: 'director', company_name: CO, manager_id: null,   director_id: null,   vp_id: 'u-vp1' },
  { id: 'u-dir2', name: 'Carlos Reyes',  email: 'dir2@solarcrm.dev',  role: 'director', company_name: CO, manager_id: null,   director_id: null,   vp_id: 'u-vp1' },
  { id: 'u-mgr1', name: 'Lisa Nguyen',   email: 'mgr1@solarcrm.dev',  role: 'manager',  company_name: CO, manager_id: null,   director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-mgr2', name: 'Tom Hargrove',  email: 'mgr2@solarcrm.dev',  role: 'manager',  company_name: CO, manager_id: null,   director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-mgr3', name: 'Amy Patel',     email: 'mgr3@solarcrm.dev',  role: 'manager',  company_name: CO, manager_id: null,   director_id: 'u-dir2', vp_id: 'u-vp1' },
  { id: 'u-r1',   name: 'Alex Torres',   email: 'alex@solarcrm.dev',  role: 'rep',      company_name: CO, manager_id: 'u-mgr1', director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-r2',   name: 'Ben Marsh',     email: 'ben@solarcrm.dev',   role: 'rep',      company_name: CO, manager_id: 'u-mgr1', director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-r3',   name: 'Chris Lane',    email: 'chris@solarcrm.dev', role: 'rep',      company_name: CO, manager_id: 'u-mgr1', director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-r4',   name: 'Dana Wells',    email: 'dana@solarcrm.dev',  role: 'rep',      company_name: CO, manager_id: 'u-mgr1', director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-r5',   name: 'Eve Santos',    email: 'eve@solarcrm.dev',   role: 'rep',      company_name: CO, manager_id: 'u-mgr2', director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-r6',   name: 'Frank Obi',     email: 'frank@solarcrm.dev', role: 'rep',      company_name: CO, manager_id: 'u-mgr2', director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-r7',   name: 'Grace Moon',    email: 'grace@solarcrm.dev', role: 'rep',      company_name: CO, manager_id: 'u-mgr2', director_id: 'u-dir1', vp_id: 'u-vp1' },
  { id: 'u-r8',   name: 'Hank Davis',    email: 'hank@solarcrm.dev',  role: 'rep',      company_name: CO, manager_id: 'u-mgr3', director_id: 'u-dir2', vp_id: 'u-vp1' },
  { id: 'u-r9',   name: 'Ivy Chen',      email: 'ivy@solarcrm.dev',   role: 'rep',      company_name: CO, manager_id: 'u-mgr3', director_id: 'u-dir2', vp_id: 'u-vp1' },
  { id: 'u-r10',  name: 'Jack Rivera',   email: 'jack@solarcrm.dev',  role: 'rep',      company_name: CO, manager_id: 'u-mgr3', director_id: 'u-dir2', vp_id: 'u-vp1' },
  { id: 'u-r11',  name: 'Kate Burns',    email: 'kate@solarcrm.dev',  role: 'rep',      company_name: CO, manager_id: 'u-mgr3', director_id: 'u-dir2', vp_id: 'u-vp1' },
  { id: 'u-adm1', name: 'Admin User',    email: 'admin@solarcrm.dev', role: 'admin',    company_name: CO, manager_id: null, director_id: null, vp_id: null },
]

// Helper to get date string N days ago
const daysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

const demoDeal = (overrides) => ({
  id: `deal-${Math.random().toString(36).slice(2,9)}`,
  address: null, project_id: null, install_date: null, pay_date: null,
  manager_id: 'u-mgr1', manager_override_pct: 0.04,
  director_id: 'u-dir1', director_override_pct: 0.025,
  vp_id: 'u-vp1', vp_override_pct: 0.015,
  created_by: 'u-adm1',
  created_at: new Date().toISOString(),
  ...overrides,
})

export const DEMO_DEALS = [
  demoDeal({ deal_name:'Anderson Residence', address:'142 Oak St, Phoenix AZ',      project_id:'SPX-1001', sale_date:daysAgo(180), install_date:daysAgo(160), pay_date:daysAgo(153), setter_id:'u-r1',  closer_id:'u-r1',  baseline_revenue:5200, job_price:9800,  status:'Paid' }),
  demoDeal({ deal_name:'Bradley Family',     address:'88 Pine Ave, Tempe AZ',       project_id:'SPX-1002', sale_date:daysAgo(175), install_date:daysAgo(155), pay_date:daysAgo(148), setter_id:'u-r2',  closer_id:'u-r3',  baseline_revenue:4800, job_price:8500,  status:'Paid' }),
  demoDeal({ deal_name:'Carter Solar',       address:'210 Elm Dr, Mesa AZ',         project_id:'SPX-1003', sale_date:daysAgo(172), install_date:daysAgo(150), pay_date:daysAgo(143), setter_id:'u-r4',  closer_id:'u-r4',  baseline_revenue:6100, job_price:11200, status:'Paid' }),
  demoDeal({ deal_name:'Davis Home',         address:'55 Cedar Ln, Chandler AZ',    project_id:'SPX-1004', sale_date:daysAgo(168), install_date:daysAgo(145), pay_date:daysAgo(138), setter_id:'u-r5',  closer_id:'u-r6',  baseline_revenue:3800, job_price:7400,  status:'Paid',      manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Evans Project',      address:'790 Maple Rd, Gilbert AZ',    project_id:'SPX-1005', sale_date:daysAgo(165), install_date:null,         pay_date:daysAgo(130), setter_id:'u-r7',  closer_id:'u-r7',  baseline_revenue:5500, job_price:10100, status:'Paid',      manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Foster Residence',   address:'33 Birch Ct, Scottsdale AZ',  project_id:'SPX-1006', sale_date:daysAgo(150), install_date:daysAgo(130), setter_id:'u-r8',  closer_id:'u-r9',  baseline_revenue:4200, job_price:8100,  status:'Installed', manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Garcia Family',      address:'415 Spruce Way, Peoria AZ',   project_id:'SPX-1007', sale_date:daysAgo(145), install_date:daysAgo(125), setter_id:'u-r10', closer_id:'u-r10', baseline_revenue:5800, job_price:12000, status:'Installed', manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Hernandez Solar',    address:'22 Walnut Blvd, Glendale AZ', project_id:'SPX-1008', sale_date:daysAgo(142), install_date:daysAgo(120), setter_id:'u-r11', closer_id:'u-r11', baseline_revenue:6800, job_price:14500, status:'Installed', manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Ingram Home',        address:'701 Aspen St, Surprise AZ',   project_id:'SPX-1009', sale_date:daysAgo(138), install_date:null,         setter_id:'u-r1',  closer_id:'u-r2',  baseline_revenue:4600, job_price:9200,  status:'Installed' }),
  demoDeal({ deal_name:'Jensen Project',     address:'58 Poplar Ave, Avondale AZ',  project_id:'SPX-1010', sale_date:daysAgo(135), install_date:daysAgo(110), setter_id:'u-r3',  closer_id:'u-r3',  baseline_revenue:3500, job_price:6800,  status:'Installed' }),
  demoDeal({ deal_name:'Kim Residence',      address:'320 Willow Dr, Buckeye AZ',   project_id:'SPX-1011', sale_date:daysAgo(120), install_date:daysAgo(98),  setter_id:'u-r4',  closer_id:'u-r5',  baseline_revenue:5100, job_price:9600,  status:'Installed' }),
  demoDeal({ deal_name:'Lopez Family',       address:'14 Magnolia Ln, Goodyear AZ', project_id:'SPX-1012', sale_date:daysAgo(118), install_date:daysAgo(95),  setter_id:'u-r6',  closer_id:'u-r6',  baseline_revenue:7200, job_price:13800, status:'Installed', manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Morris Solar',       address:'89 Cypress Ct, Maricopa AZ',  project_id:'SPX-1013', sale_date:daysAgo(115), install_date:null,         setter_id:'u-r7',  closer_id:'u-r8',  baseline_revenue:4000, job_price:7600,  status:'Scheduled', manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Nelson Home',        address:'256 Redwood Rd, Queen Crk AZ',project_id:'SPX-1014', sale_date:daysAgo(112), install_date:null,         setter_id:'u-r9',  closer_id:'u-r9',  baseline_revenue:5600, job_price:10400, status:'Scheduled', manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Ortega Project',     address:'103 Sycamore Way, Cave Crk AZ',project_id:'SPX-1015',sale_date:daysAgo(108), install_date:daysAgo(85),  setter_id:'u-r10', closer_id:'u-r11', baseline_revenue:6400, job_price:12800, status:'Installed', manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Park Residence',     address:'77 Juniper St, Fountain Hls', project_id:'SPX-1016', sale_date:daysAgo(92),  install_date:null,         setter_id:'u-r1',  closer_id:'u-r1',  baseline_revenue:4900, job_price:9100,  status:'Scheduled' }),
  demoDeal({ deal_name:'Quinn Family',       address:'445 Rosewood Ave, Tempe AZ',  project_id:'SPX-1017', sale_date:daysAgo(88),  install_date:daysAgo(65),  setter_id:'u-r2',  closer_id:'u-r2',  baseline_revenue:5300, job_price:10200, status:'Installed' }),
  demoDeal({ deal_name:'Ramirez Solar',      address:'19 Ironwood Dr, Chandler AZ', project_id:'SPX-1018', sale_date:daysAgo(85),  install_date:null,         setter_id:'u-r3',  closer_id:'u-r4',  baseline_revenue:6700, job_price:13500, status:'Scheduled' }),
  demoDeal({ deal_name:'Silva Home',         address:'382 Palo Verde Ln, Gilbert',  project_id:'SPX-1019', sale_date:daysAgo(82),  install_date:null,         setter_id:'u-r5',  closer_id:'u-r5',  baseline_revenue:4100, job_price:8300,  status:'Scheduled', manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Thompson Project',   address:'66 Desert Willow Rd, Mesa AZ',project_id:'SPX-1020', sale_date:daysAgo(79),  install_date:daysAgo(55),  setter_id:'u-r6',  closer_id:'u-r7',  baseline_revenue:5700, job_price:11000, status:'Installed', manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Underwood Residence',address:'509 Ocotillo Ct, Scottsdale', project_id:'SPX-1021', sale_date:daysAgo(65),  install_date:null,         setter_id:'u-r8',  closer_id:'u-r8',  baseline_revenue:7800, job_price:15000, status:'Scheduled', manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Vargas Family',      address:'231 Saguaro Blvd, Phoenix AZ',project_id:'SPX-1022', sale_date:daysAgo(62),  install_date:null,         setter_id:'u-r9',  closer_id:'u-r10', baseline_revenue:4400, job_price:8800,  status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Walker Solar',       address:'148 Brittlebush Way, Peoria', project_id:'SPX-1023', sale_date:daysAgo(58),  install_date:null,         setter_id:'u-r11', closer_id:'u-r11', baseline_revenue:6200, job_price:12200, status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Xavier Home',        address:'73 Cholla St, Glendale AZ',   project_id:'SPX-1024', sale_date:daysAgo(55),  install_date:null,         setter_id:'u-r1',  closer_id:'u-r2',  baseline_revenue:3000, job_price:6100,  status:'Sold' }),
  demoDeal({ deal_name:'Young Project',      address:'824 Prickly Pear Rd, Tempe',  project_id:'SPX-1025', sale_date:daysAgo(52),  install_date:null,         setter_id:'u-r3',  closer_id:'u-r3',  baseline_revenue:5400, job_price:10600, status:'Sold' }),
  demoDeal({ deal_name:'Zamora Residence',   address:'35 Creosote Ln, Mesa AZ',     project_id:'SPX-1026', sale_date:daysAgo(38),  install_date:null,         setter_id:'u-r4',  closer_id:'u-r4',  baseline_revenue:6500, job_price:12700, status:'Sold' }),
  demoDeal({ deal_name:'Abbott Family',      address:'167 Barrel Cactus Dr, Chandlr',project_id:'SPX-1027',sale_date:daysAgo(35),  install_date:null,         setter_id:'u-r5',  closer_id:'u-r6',  baseline_revenue:4700, job_price:9400,  status:'Sold',      manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Baker Solar',        address:'290 Joshua Tree Ave, Gilbert', project_id:'SPX-1028', sale_date:daysAgo(32),  install_date:null,         setter_id:'u-r7',  closer_id:'u-r7',  baseline_revenue:5900, job_price:11800, status:'Sold',      manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Castro Home',        address:'411 Mesquite Ct, Scottsdale',  project_id:'SPX-1029', sale_date:daysAgo(28),  install_date:null,         setter_id:'u-r8',  closer_id:'u-r9',  baseline_revenue:6000, job_price:12500, status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Dixon Project',      address:'52 Agave Blvd, Surprise AZ',   project_id:'SPX-1030', sale_date:daysAgo(25),  install_date:null,         setter_id:'u-r10', closer_id:'u-r10', baseline_revenue:4300, job_price:8700,  status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Ellis Residence',    address:'183 Sotol Way, Avondale AZ',   project_id:'SPX-1031', sale_date:daysAgo(22),  install_date:null,         setter_id:'u-r11', closer_id:'u-r11', baseline_revenue:7400, job_price:14200, status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Fletcher Family',    address:'64 Yucca Rd, Buckeye AZ',      project_id:'SPX-1032', sale_date:daysAgo(19),  install_date:null,         setter_id:'u-r1',  closer_id:'u-r1',  baseline_revenue:5000, job_price:9700,  status:'Sold' }),
  demoDeal({ deal_name:'Gonzalez Solar',     address:'327 Ironwood Cir, Goodyear AZ',project_id:'SPX-1033', sale_date:daysAgo(16),  install_date:null,         setter_id:'u-r2',  closer_id:'u-r3',  baseline_revenue:4500, job_price:8800,  status:'Sold' }),
  demoDeal({ deal_name:'Harper Home',        address:'78 Lupine Ct, Maricopa AZ',    project_id:'SPX-1034', sale_date:daysAgo(13),  install_date:null,         setter_id:'u-r4',  closer_id:'u-r4',  baseline_revenue:6300, job_price:12400, status:'Sold' }),
  demoDeal({ deal_name:'Irving Project',     address:'215 Verbena Dr, Queen Crk AZ', project_id:'SPX-1035', sale_date:daysAgo(10),  install_date:null,         setter_id:'u-r5',  closer_id:'u-r5',  baseline_revenue:3200, job_price:6500,  status:'Sold',      manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Jackson Residence',  address:'449 Lantana Blvd, Cave Crk',   project_id:'SPX-1036', sale_date:daysAgo(8),   install_date:null,         setter_id:'u-r6',  closer_id:'u-r7',  baseline_revenue:5100, job_price:10300, status:'Sold',      manager_id:'u-mgr2', manager_override_pct:0.035 }),
  demoDeal({ deal_name:'Klein Family',       address:'91 Bougainvillea Ln, Fountain', project_id:'SPX-1037',sale_date:daysAgo(6),   install_date:null,         setter_id:'u-r8',  closer_id:'u-r8',  baseline_revenue:6900, job_price:13700, status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Lane Solar',         address:'374 Hibiscus St, Tempe AZ',    project_id:'SPX-1038', sale_date:daysAgo(4),   install_date:null,         setter_id:'u-r9',  closer_id:'u-r10', baseline_revenue:4800, job_price:9200,  status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Moore Home',         address:'137 Oleander Rd, Chandler AZ', project_id:'SPX-1039', sale_date:daysAgo(2),   install_date:null,         setter_id:'u-r11', closer_id:'u-r11', baseline_revenue:5500, job_price:10800, status:'Sold',      manager_id:'u-mgr3', manager_override_pct:0.04, director_id:'u-dir2', director_override_pct:0.03 }),
  demoDeal({ deal_name:'Nash Project',       address:'502 Jasmine Way, Gilbert AZ',  project_id:'SPX-1040', sale_date:daysAgo(1),   install_date:null,         setter_id:'u-r1',  closer_id:'u-r2',  baseline_revenue:7000, job_price:14800, status:'Sold' }),
]

// Resolve setter/closer/manager/director/vp as joined objects
export const DEMO_DEALS_JOINED = DEMO_DEALS.map(d => ({
  ...d,
  setter:   DEMO_USERS.find(u => u.id === d.setter_id)  ?? null,
  closer:   DEMO_USERS.find(u => u.id === d.closer_id)  ?? null,
  manager:  DEMO_USERS.find(u => u.id === d.manager_id) ?? null,
  director: DEMO_USERS.find(u => u.id === d.director_id)?? null,
  vp:       DEMO_USERS.find(u => u.id === d.vp_id)      ?? null,
}))

// Sample payments for the 5 "Paid" deals
export const DEMO_PAYMENTS = [
  { id:'pay-1', deal_id: DEMO_DEALS[0].id, user_id:'u-r1',   amount:2300, pay_date:daysAgo(145), notes:'Full commission payout' },
  { id:'pay-2', deal_id: DEMO_DEALS[0].id, user_id:'u-mgr1', amount:184,  pay_date:daysAgo(145), notes:'Manager override' },
  { id:'pay-3', deal_id: DEMO_DEALS[0].id, user_id:'u-dir1', amount:115,  pay_date:daysAgo(145), notes:'Director override' },
  { id:'pay-4', deal_id: DEMO_DEALS[0].id, user_id:'u-vp1',  amount:69,   pay_date:daysAgo(145), notes:'VP override' },
  { id:'pay-5', deal_id: DEMO_DEALS[1].id, user_id:'u-r2',   amount:925,  pay_date:daysAgo(140), notes:'Setter commission' },
  { id:'pay-6', deal_id: DEMO_DEALS[1].id, user_id:'u-r3',   amount:925,  pay_date:daysAgo(140), notes:'Closer commission' },
  { id:'pay-7', deal_id: DEMO_DEALS[1].id, user_id:'u-mgr1', amount:148,  pay_date:daysAgo(140), notes:'Manager override' },
  { id:'pay-8', deal_id: DEMO_DEALS[2].id, user_id:'u-r4',   amount:2550, pay_date:daysAgo(135), notes:'Full commission payout' },
  { id:'pay-9', deal_id: DEMO_DEALS[2].id, user_id:'u-mgr1', amount:204,  pay_date:daysAgo(135), notes:'Manager override' },
  { id:'pay-10',deal_id: DEMO_DEALS[3].id, user_id:'u-r5',   amount:800,  pay_date:daysAgo(130), notes:'Setter commission' },
  { id:'pay-11',deal_id: DEMO_DEALS[3].id, user_id:'u-r6',   amount:800,  pay_date:daysAgo(130), notes:'Closer commission' },
  { id:'pay-12',deal_id: DEMO_DEALS[4].id, user_id:'u-r7',   amount:2300, pay_date:daysAgo(125), notes:'Full commission payout' },
]

// Valid demo credentials  (email → { userId, password })
export const DEMO_CREDENTIALS = {
  'admin@solarcrm.dev': { userId: 'u-adm1', password: 'Password123!' },
  'vp@solarcrm.dev':    { userId: 'u-vp1',  password: 'Password123!' },
  'dir1@solarcrm.dev':  { userId: 'u-dir1', password: 'Password123!' },
  'dir2@solarcrm.dev':  { userId: 'u-dir2', password: 'Password123!' },
  'mgr1@solarcrm.dev':  { userId: 'u-mgr1', password: 'Password123!' },
  'mgr2@solarcrm.dev':  { userId: 'u-mgr2', password: 'Password123!' },
  'mgr3@solarcrm.dev':  { userId: 'u-mgr3', password: 'Password123!' },
  'alex@solarcrm.dev':  { userId: 'u-r1',   password: 'Password123!' },
  'ben@solarcrm.dev':   { userId: 'u-r2',   password: 'Password123!' },
  'chris@solarcrm.dev': { userId: 'u-r3',   password: 'Password123!' },
  'dana@solarcrm.dev':  { userId: 'u-r4',   password: 'Password123!' },
  'eve@solarcrm.dev':   { userId: 'u-r5',   password: 'Password123!' },
  'frank@solarcrm.dev': { userId: 'u-r6',   password: 'Password123!' },
  'grace@solarcrm.dev': { userId: 'u-r7',   password: 'Password123!' },
  'hank@solarcrm.dev':  { userId: 'u-r8',   password: 'Password123!' },
  'ivy@solarcrm.dev':   { userId: 'u-r9',   password: 'Password123!' },
  'jack@solarcrm.dev':  { userId: 'u-r10',  password: 'Password123!' },
  'kate@solarcrm.dev':  { userId: 'u-r11',  password: 'Password123!' },
}
