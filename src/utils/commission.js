COPY . /app/.
778ms

stage-0
RUN npm run build
5s
npm warn config production Use `--omit=dev` instead.
> turf-time-dashboard@1.0.0 build
> vite build
vite v5.4.21 building for production...
transforming...
x Build failed in 2.77s
error during build:
src/components/DealTable.jsx (2:9): "calcDealCommissions" is not exported by "src/utils/commission.js", imported by "src/components/DealTable.jsx".
file: /app/src/components/DealTable.jsx:2:9
1: import { ChevronUp, ChevronDown, ChevronsUpDown, Pencil, Trash2 } from 'lucide-react'
2: import { calcDealCommissions, fmt, fmtPct } from '../utils/commission'
            ^
3: 
4: const STATUS_STYLES = {
    at getRollupError (file:///app/node_modules/rollup/dist/es/shared/parseAst.js:406:41)
    at error (file:///app/node_modules/rollup/dist/es/shared/parseAst.js:402:42)
    at Module.error (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:17384:16)
    at Module.traceVariable (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:17817:29)
    at ModuleScope.findVariable (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:15407:39)
    at ReturnValueScope.findVariable (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:5676:38)
    at FunctionBodyScope.findVariable (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:5676:38)
    at Identifier.bind (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:5450:40)
    at CallExpression.bind (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:2832:23)
    at CallExpression.bind (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:12516:15)
Build Failed: build daemon returned an error < failed to solve: process "/bin/bash -ol pipefail -c npm run build" did not complete successfully: exit code: 1 >
