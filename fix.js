const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
// HTML中的是ASCII双引号 "智" (e282ac e699ba e282ac)
// 实际文件是中文弯引号 "智" (e2809c e699ba e2809d)
html = html.replace(/\u0043\u201C智/g, '\u201C智');  // " -> "
html = html.replace(/智\u201D\.pdf/g, '智"\u201D.pdf');  // ".pdf -> ".pdf
fs.writeFileSync('index.html', html);
console.log('Fixed');