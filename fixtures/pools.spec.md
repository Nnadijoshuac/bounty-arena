From the pool list below, return the top 5 USDC pools by TVL as JSON that matches the attached schema, largest first.

Pools (id, pair, TVL in USD, APR %)
- p01, USDC/EURC, 4120000, 3.1
- p02, USDC/USYC, 9800000, 4.6
- p03, USDC/WETH, 2210000, 7.9
- p04, USDC/cbBTC, 6450000, 5.2
- p05, USDC/DAI, 870000, 2.4
- p06, USDC/EURC, 1530000, 3.4
- p07, USDC/USDT, 12400000, 1.9
- p08, USDC/ARB, 640000, 11.2
- p09, USDC/WETH, 5070000, 8.1
- p10, USDC/SOL, 3390000, 9.6

Format
- `{ "pools": [ { "id", "pair", "tvlUsd", "apr" } ] }` with exactly five pools
- Numbers as numbers, not strings

How it is judged
- Verified bounty with a JSON check: schema plus the expected ids in order. First valid answer is paid automatically
