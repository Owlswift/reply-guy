/**
 * Detect whether a tweet's content indicates the author is into forex
 * and/or crypto trading. Used to auto-collect a Redis list of such users
 * (storage/forexCryptoHandles.ts) so a later catch-up script can run
 * through them the same way catchupStoryTellers.ts runs through
 * story-teller accounts.
 *
 * Deliberately broad — this is a discovery mechanism, not a content gate.
 * A false positive just adds one handle to a list the operator can review
 * later; a false negative loses a user who should have been collected.
 * The keyword lists below cover the common trading vocabulary across
 * forex (currency pairs, order types, charting terms) and crypto
 * (coins, exchanges, DeFi, trading slang).
 */

const FOREX_KEYWORDS: RegExp[] = [
  // Currency pairs
  /\b(eur\/usd|gbp\/usd|usd\/jpy|usd\/cad|aud\/usd|nzd\/usd|usd\/chf|gbp\/jpy|eur\/gbp|eur\/jpy|usd\/ngn|ngn\/usd)\b/i,
  // Core forex terms
  /\b(forex|fx trading|fx trader|currency pair|currency pairs|pip|pips|spread|leverage|margin call|stop loss|take profit|take-profit|tp hit|sl hit)\b/i,
  /\b(candlestick|candlesticks|candle pattern|chart pattern|support level|resistance level|breakout|breakout trade|trendline|trend line)\b/i,
  /\b(scalp|scalping|scalper|swing trade|swing trading|day trade|day trading|position trade|position trading|intraday|intra-day)\b/i,
  /\b(long position|short position|going long|going short|buy the dip|sell the rip|bullish|bearish|bull market|bear market)\b/i,
  /\b(liquidity|order block|order blocks|fair value gap|fvg|smart money|smart money concept|smc|ict trading|price action)\b/i,
  // Commodities / indices often traded alongside forex
  /\b(gold trading|silver trading|crude oil|brent|wti|nasdaq|s&p 500|dow jones|ftse|dax|nikkei|commodities|indices trading)\b/i,
  // Brokers / platforms
  /\b(metatrader|mt4|mt5|tradingview|oanda|ic markets|exness|xm broker|fxgt|hotforex|fbs|avatrade|etoro)\b/i,
  // General trading verbs
  /\b(trading account|trading platform|trading strategy|trading signal|trading journal|trade setup|trade setups|my trade|my trades|entered a trade|closed a trade)\b/i,
];

const CRYPTO_KEYWORDS: RegExp[] = [
  // Coins / tokens
  /\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|dogecoin|doge|shiba|shib|cardano|ada|polkadot|dot|avalanche|avax|chainlink|link|polygon|matic|bnb|binance coin|toncoin|ton|litecoin|ltc|ripple)\b/i,
  /\b(altcoin|altcoins|memecoin|meme coin|shitcoin|shit coin|stablecoin|stable coin|token|tokens|coin|coins)\b/i,
  // Crypto-specific terms
  /\b(crypto|cryptocurrency|cryptocurrencies|blockchain|defi|decentralized finance|web3|nft|nfts|smart contract|smart contracts|dapp|dapps|dex|cex)\b/i,
  /\b(airdrop|airdrops|staking|yield farming|liquidity pool|liquidity pools|mining|miner|miners|halving|whale|whales|diamond hands|paper hands)\b/i,
  /\b(hodl|hodling|fomo|fud|moon|mooning|lambo|wen lambo|pump|pump and dump|rug|rugpull|rug pull|scam coin|dead coin)\b/i,
  /\b(bull run|bear market|bull market|market cap|mcap|circulating supply|total supply|burn|tokenomics|whitepaper|white paper|roadmap)\b/i,
  /\b(buy the dip|dca|dollar cost average|dollar-cost average|accumulate|accumulation|distribution|exit liquidity|bag holder|bagholding)\b/i,
  // Exchanges / wallets
  /\b(binance|coinbase|bybit|okx|kucoin|kraken|gate\.io|mexc|bitget|htx|huobi|gemini|ledger|metamask|phantom wallet|trust wallet|exodus)\b/i,
  // Trading verbs
  /\b(crypto trading|crypto trader|trading bot|trading bots|grid trading|spot trading|futures trading|perpetual|perps|leverage trading|margin trading)\b/i,
];

/**
 * Returns true if the given text contains forex and/or crypto trading
 * vocabulary. Checks the full text (threads included) so a multi-tweet
 * thread that mentions trading anywhere in it still counts.
 */
export function isForexOrCrypto(text: string): boolean {
  if (!text) return false;
  for (const pattern of FOREX_KEYWORDS) {
    if (pattern.test(text)) return true;
  }
  for (const pattern of CRYPTO_KEYWORDS) {
    if (pattern.test(text)) return true;
  }
  return false;
}