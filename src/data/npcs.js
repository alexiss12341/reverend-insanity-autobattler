// Recruitable cultivators (gacha). Each named character is a canon *Reverend Insanity*
// figure with a FIXED rarity tied to its peak cultivation rank, so a name means something:
//   Immortal  = Venerable (rank 9)      Rare     = rank 4-5 Gu Master
//   Legendary = rank 8 Gu Immortal      Uncommon = rank 2-3 Gu Master
//   Epic      = rank 6-7 Gu Immortal    Common   = rank 1 Gu Master / mortals
// The gacha rolls a rarity, then `nameForRarity` picks a character from that tier. Duplicates
// are allowed (a tier with N names just repeats across pulls), which is why the most-pulled
// tiers (Common/Uncommon) hold the most names. Fang Yuan is the PLAYER and never a recruit.
export const NAMED_HEROES = {
  Common: [
    // Gu Yue clan (lesser / rank 1, Qing Mao Mountain)
    'Gu Yue Bei', 'Gu Yue Ding Zong', 'Gu Yue Jin Zhu', 'Gu Yue Peng', 'Gu Yue Yao Le',
    'Gu Yue Sheng Nan', 'Gu Yue Jiang Jian', 'Jiang Ya',
    // Gu Yue Village commoners (Fang Yuan's first life)
    'Shen Cui', 'Mother Shen', 'Er Gou Dan', 'Wang Er', 'Sister Wang', 'Old Man Wang', 'Wan Er',
    'Ah Feng', 'Ah Hai', 'Ah Xing', 'Xiao Hua', 'Gao Wan', 'Tie Xue Leng', 'Jiang Fan', 'Jia Jin Sheng',
    // Xiong family
    'Xiong Lin', 'Xiong Jiao Man', 'Xiong Jiang', 'Xiong Zhan', 'Xiong Xin', 'Xiong Yuan Zhen',
    // Bai clan (lesser)
    'Bai Sheng', 'Bai Hua', 'Bai Zhan Wen', 'Bai Shan Zi',
    // Shang Clan City (servants / mortals)
    'Sun Gan', 'Old Steward', 'Brother Qiang', 'Skinny Monkey', 'Chen Shuang Jin', 'Chen Xin',
    'Zhang Zhu', 'Xiao Die', 'Su Shou', 'Jiu Zhi', 'Sheng Shou', 'Sha Ren',
    // Shang clan (the nine dragon-sons)
    'Shang Yan Fei', 'Shang Ya Zi', 'Shang Tuo Hai', 'Shang Chao Feng', 'Shang Qiu Niu', 'Shang Pu Lao',
    'Shang Pi Xiu', 'Shang Suan Ni', 'Shang Fu Xi', 'Shang Bi Xi', 'Shang Bi An', 'Shang Chi Wen',
    // Other early-arc mortals
    'Ah Qing', 'Ah Ya', 'Xiao San', 'Xiao Lan', 'Xiao Si', 'Nanny Wu', 'Plump Lady',
    'Master Huang', 'Master Zhang', 'Master Zhao', 'Wang Da Han', 'Ma De Quan', 'Zhao Da Xiong',
    'Zhang Niu', 'Qiao Da', 'Qiao Er', 'Tang Qing', 'Tang Xiong', 'Lady An Yu', 'Wang Han',
    'Tan Jing', 'Shi Nan Sheng', 'Sang Kong', 'Zhu Ba', 'Jin Bian Yuan', 'Liao Hua Dong',
    'Zhong De', 'Tie Mu', 'Ju Kai Bei', 'Tian Lan',
  ],
  Uncommon: [
    // Gu Yue clan (rank 2-3)
    'Gu Yue Mo Chen', 'Gu Yue Chi Lian', 'Gu Yue Chi Cheng', 'Gu Yue Dong Tu', 'Mo Bei',
    'Gu Yue Mo Yan', 'Gu Yue Sou', 'Gu Yue Yao Hong', 'Gu Yue Ye', 'Jiang He', 'Gu Yue Jiao San',
    'Gu Yue Kong Jing', 'Gu Yue Li Chen', 'Gu Yue Man Shi', 'Gu Yue Qing Shu', 'Hua Xin', 'Chi She',
    'Gu Yue Chi Shan', 'Gu Yue Chi Guang', 'Gu Yue Chi Zhong', 'Gu Yue Ge Yan', 'Gu Yue Suo Ping',
    'Gu Yue Yao Ji', 'Gu Yue Yao Zhong',
    // Gu Yue clan hall elders
    'Academy Elder', 'Battle Hall Elder', 'Punishment Hall Elder', 'Dark Hall Elder', 'Secret Hall Elder',
    // Bai clan
    'Bai Bing Yi', 'Bai Sheng Jing', 'Bai Zhong Shui', 'Bai Feng', 'Bai Lian', 'Bai Mo Xing', 'Bai Zhan Lie',
    // Xiong / Jia
    'Xiong Li', 'Xiong Feng', 'Xiong Huo', 'Xiong Tu', 'Jia Yong', 'Jia Long',
    // Other Southern Border
    'Bei Cao Sheng', 'Meng Tu', 'Li Ran', 'Master Ma', 'Ou Fei', 'Xia Lin', 'Wang Da', 'Master Duan',
    'Tie Dao Ku', 'Tang Fang', 'Shi Wu', 'Xiao Yan', 'Old Zhang', 'Li Hao', 'Ma You Liang',
  ],
  Rare: [
    // rank 4-5 Gu Masters (wiki-verified)
    'Flower Wine Monk', 'Century Boy', 'Long Qing Tian', 'Chang Shan Yin', 'Hei Xiu Yi', 'Mo Shi Kuang',
    'Mo Wu Tian', 'Second Zombie King', 'Ku Mo', 'Dou E', 'Ying Sheng Ji', 'Tie Ruo Nan',
    'Tang Ru Qi', 'Gu Yue Bo', 'Ha Tu Gu', 'Ye Lui Sang', 'Dong Fang She', 'Xie Han Mo',
    'Tan Wu Feng', 'Wu Lan Shan', 'Zhang Kai Zui', 'Man Tu', 'Wei Wu Shang', 'Sun Yuan Hua',
    'Zhao Tribe Leader', 'Shang Xin Ci',
    // clan-derived (rank 4-5)
    'Jia Fu', 'Jia Gui', 'Tie Ba Xiu', 'Ma Ying Jie', 'Ouyang Bi Sang', 'Wang Xiao',
  ],
  Epic: [
    // rank 6-7 Gu Immortals (wiki-verified)
    'Hei Lou Lan', 'Zhao Lian Yun', 'Mo Yao', 'Zi Yan Ran', 'Dong Fang Chang Fan', 'Murong Qing Si',
    'Hei Cheng', 'Qin Bai Sheng', 'Chi Shang', 'Gu Yue Fang Zheng', 'Fairy Li Shan', 'Fairy Jiang Yu',
    'Fairy Qing Suo', 'Fairy Fen Meng', 'Old Man Yan Shi', 'Yin Liu Gong', 'Jian Yi Sheng',
    'Qian Zhu Xian', 'Valley Lord Ming He', 'Guan Shen Zhao', 'Ye Lui Qun Xing',
    'Ma Hong Yun', 'Feng Jin Huang',
  ],
  Legendary: [
    // rank 8 Gu Immortals. (Suan Bu Jin omitted — it's one of Fang Yuan's fake identities, not a recruit.)
    'Feng Jiu Ge', 'Bai Ning Bing', 'Tai Bai Yun Sheng', 'Wu Yong', 'Bo Qing', 'Lang Ya', 'Duke Long',
    'Lu Wei Yin', 'Bing Sai Chuan', 'Qing Chou', 'Chu Du', 'Fairy Zi Wei',
    'Purple Mountain True Monarch', 'Bai Cang Shui', 'Hei Fan', 'Shi Lei', 'Ba Shi Ba',
  ],
  Immortal: [
    // Venerables (rank 9). Omitted on purpose: Ren Zu (Human Ancestor — locked Human Supreme path,
    // mythic, not a recruit) and Great Dream Venerable (not an established canon figure here).
    'Spectral Soul Demon Venerable', 'Red Lotus Demon Venerable', 'Star Constellation Sage',
    'Giant Sun Immortal Venerable', 'Paradise Earth Venerable',
    'Limitless Demon Venerable', 'Genesis Lotus', 'Thieving Heaven', 'Reckless Savage Demon Venerable',
  ],
};

// Pick a recruit name for a rolled rarity. Falls back to Common if a tier is ever empty/unknown,
// so a pull can never throw.
export function nameForRarity(rarity) {
  const pool = NAMED_HEROES[rarity] || NAMED_HEROES.Common;
  return pool[Math.floor(Math.random() * pool.length)];
}
