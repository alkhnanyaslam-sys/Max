require('dotenv').config()
const { Telegraf, Markup } = require('telegraf')
const express = require('express')
const path    = require('path')
const sm      = require('./streamManager')

const bot = new Telegraf(process.env.BOT_TOKEN)
const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'dashboard')))

const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(Number)
const SOURCES   = {
  mecca:  { name: '🕋 الحرم المكي',  url: process.env.MECCA_STREAM_URL  },
  madina: { name: '🕌 الحرم المدني', url: process.env.MADINA_STREAM_URL },
}

// ══════════════════════════════════════
// Middleware — أدمن فقط
// ══════════════════════════════════════
const adminOnly = (ctx, next) => {
  if (!ADMIN_IDS.includes(ctx.from?.id)) {
    return ctx.reply('⛔ هذا الأمر للمسؤولين فقط')
  }
  return next()
}

// ══════════════════════════════════════
// لوحة التحكم الرئيسية
// ══════════════════════════════════════
const mainMenu = (ctx) => {
  const stats = sm.getStats()
  const text  = `
🎛️ *Ultra Stream Bot — لوحة التحكم*

📊 *الحالة الآن:*
🟢 بث مباشر: \`${stats.live}\`
⚪ متوقف: \`${stats.idle}\`
🔴 خطأ: \`${stats.error}\`
📡 إجمالي القنوات والجروبات: \`${stats.total}\`
  `.trim()

  return ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    [
      Markup.button.callback('🕋 تشغيل مكة للكل',    'start_all_mecca'),
      Markup.button.callback('🕌 تشغيل المدينة للكل','start_all_madina'),
    ],
    [
      Markup.button.callback('⏹ إيقاف الكل',         'stop_all'),
      Markup.button.callback('🔄 إعادة تشغيل الكل',  'restart_all'),
    ],
    [
      Markup.button.callback('📋 القنوات والجروبات', 'list_channels'),
      Markup.button.callback('➕ إضافة',              'add_channel'),
    ],
    [
      Markup.button.callback('📊 إحصائيات',          'stats'),
      Markup.button.callback('❓ مساعدة',             'help'),
    ],
  ]))
}

// ══════════════════════════════════════
// الأوامر
// ══════════════════════════════════════
bot.start(adminOnly, ctx => mainMenu(ctx))
bot.command('menu',  adminOnly, ctx => mainMenu(ctx))

bot.command('help', ctx => {
  ctx.replyWithMarkdown(`
📖 *أوامر البوت:*

/start أو /menu — لوحة التحكم
/addchannel — إضافة قناة أو جروب
/list — قائمة القنوات والجروبات
/stats — الإحصائيات
/stopall — إيقاف كل البثوث
/help — المساعدة

*كيفية الإضافة:*
1. أضف البوت كأدمن في القناة أو الجروب
2. استخدم /addchannel
3. أدخل Chat ID والـ RTMP ومفتاح البث
  `)
})

bot.command('list',    adminOnly, ctx => listChannels(ctx))
bot.command('stopall', adminOnly, ctx => {
  sm.getAllChannels().forEach(ch => sm.stopStream(ch.id))
  ctx.reply('⏹ تم إيقاف جميع البثوث')
})

bot.command('stats', adminOnly, ctx => {
  const stats    = sm.getStats()
  const channels = sm.getAllChannels()
  let text = `📊 *الإحصائيات الكاملة*\n\n`
  text += `🟢 Live: ${stats.live} | ⚪ Idle: ${stats.idle} | 🔴 Error: ${stats.error}\n\n`
  channels.forEach(ch => {
    const icon = ch.status === 'live' ? '🟢' : ch.status === 'error' ? '🔴' : '⚪'
    text += `${icon} *${ch.title}*\n`
    text += `   المصدر: ${ch.source || '—'}\n`
    text += `   مدة البث: \`${sm.getUptime(ch.id)}\`\n\n`
  })
  ctx.replyWithMarkdown(text)
})

// ══════════════════════════════════════
// إضافة قناة أو جروب — خطوات
// ══════════════════════════════════════
const addSteps = new Map()

bot.command('addchannel', adminOnly, ctx => startAddFlow(ctx))
bot.action('add_channel', adminOnly, ctx => { ctx.answerCbQuery(); startAddFlow(ctx) })

function startAddFlow(ctx) {
  addSteps.set(ctx.from.id, { step: 1 })
  ctx.replyWithMarkdown(`
➕ *إضافة قناة أو جروب*

*الخطوة 1/4:* أرسل Chat ID
للحصول عليه: أضف @userinfobot للجروب أو القناة

مثال: \`-1001234567890\`
  `)
}

bot.on('text', adminOnly, async (ctx) => {
  const userId = ctx.from.id
  const state  = addSteps.get(userId)
  if (!state) return

  const text = ctx.message.text.trim()

  if (state.step === 1) {
    state.chatId = text
    state.step   = 2
    addSteps.set(userId, state)
    return ctx.replyWithMarkdown('*الخطوة 2/4:* أرسل اسم القناة أو الجروب:')
  }

  if (state.step === 2) {
    state.title = text
    state.step  = 3
    addSteps.set(userId, state)
    return ctx.replyWithMarkdown(`
*الخطوة 3/4:* أرسل RTMP URL

أمثلة:
YouTube: \`rtmp://a.rtmp.youtube.com/live2\`
Facebook: \`rtmp://live-api.facebook.com/rtmp\`
Twitch: \`rtmp://live.twitch.tv/app\`
    `)
  }

  if (state.step === 3) {
    state.rtmpUrl = text
    state.step    = 4
    addSteps.set(userId, state)
    return ctx.replyWithMarkdown('*الخطوة 4/4:* أرسل مفتاح البث 🔒\n_(سيتم حذف رسالتك فوراً للحماية)_')
  }

  if (state.step === 4) {
    state.streamKey = text
    addSteps.delete(userId)

    // حذف رسالة المفتاح فوراً للأمان
    try { await ctx.deleteMessage() } catch(e) {}

    sm.addChannel(state.chatId, state.title, state.rtmpUrl, state.streamKey)

    ctx.replyWithMarkdown(
      `✅ *تمت الإضافة بنجاح!*\n\n` +
      `📺 الاسم: \`${state.title}\`\n` +
      `🆔 Chat ID: \`${state.chatId}\`\n` +
      `🔒 مفتاح البث: محمي`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('🕋 بث مكة الآن',    `stream_mecca_${state.chatId}`),
          Markup.button.callback('🕌 بث المدينة الآن',`stream_madina_${state.chatId}`),
        ],
        [Markup.button.callback('🔙 القائمة الرئيسية','main_menu')],
      ])
    )
  }
})

// ══════════════════════════════════════
// Actions
// ══════════════════════════════════════
bot.action('main_menu', ctx => { ctx.answerCbQuery(); mainMenu(ctx) })

bot.action('start_all_mecca', adminOnly, async ctx => {
  ctx.answerCbQuery('⏳ جاري تشغيل بث مكة...')
  const channels = sm.getAllChannels()
  if (!channels.length) return ctx.reply('⚠️ لا توجد قنوات. أضف قناة أو جروب أولاً بـ /addchannel')
  let txt = '🕋 *نتيجة تشغيل بث مكة:*\n\n'
  for (const ch of channels) {
    const r = sm.startStream(ch.id, SOURCES.mecca.url, 'best')
    txt += r.ok ? `✅ ${ch.title}\n` : `❌ ${ch.title}: ${r.msg}\n`
  }
  ctx.replyWithMarkdown(txt)
})

bot.action('start_all_madina', adminOnly, async ctx => {
  ctx.answerCbQuery('⏳ جاري تشغيل بث المدينة...')
  const channels = sm.getAllChannels()
  if (!channels.length) return ctx.reply('⚠️ لا توجد قنوات. أضف قناة أو جروب أولاً بـ /addchannel')
  let txt = '🕌 *نتيجة تشغيل بث المدينة:*\n\n'
  for (const ch of channels) {
    const r = sm.startStream(ch.id, SOURCES.madina.url, 'best')
    txt += r.ok ? `✅ ${ch.title}\n` : `❌ ${ch.title}: ${r.msg}\n`
  }
  ctx.replyWithMarkdown(txt)
})

bot.action('stop_all', adminOnly, ctx => {
  ctx.answerCbQuery('⏹ جاري الإيقاف...')
  const channels = sm.getAllChannels()
  channels.forEach(ch => sm.stopStream(ch.id))
  ctx.reply(`⏹ تم إيقاف ${channels.length} بث`)
})

bot.action('restart_all', adminOnly, ctx => {
  ctx.answerCbQuery('🔄 جاري إعادة التشغيل...')
  const channels = sm.getAllChannels()
  channels.forEach(ch => sm.restartStream(ch.id))
  ctx.reply(`🔄 جاري إعادة تشغيل ${channels.length} قناة/جروب...`)
})

bot.action('stats', adminOnly, ctx => {
  ctx.answerCbQuery()
  const s = sm.getStats()
  ctx.replyWithMarkdown(
    `📊 *الإحصائيات*\n\n🟢 Live: \`${s.live}\`\n⚪ Idle: \`${s.idle}\`\n🔴 Error: \`${s.error}\`\n📡 Total: \`${s.total}\``
  )
})

bot.action('help', ctx => {
  ctx.answerCbQuery()
  ctx.replyWithMarkdown(`
📖 *كيفية الاستخدام:*

1️⃣ أضف البوت كـ *أدمن* في القناة أو الجروب
2️⃣ اضغط ➕ إضافة أو استخدم /addchannel
3️⃣ أدخل Chat ID (من @userinfobot)
4️⃣ أدخل اسم القناة/الجروب
5️⃣ أدخل RTMP URL ومفتاح البث
6️⃣ اضغط تشغيل مكة أو المدينة

*ملاحظة:* البث يعمل في قنوات وجروبات عادية ✅
  `)
})

bot.action('list_channels', adminOnly, ctx => { ctx.answerCbQuery(); listChannels(ctx) })

function listChannels(ctx) {
  const channels = sm.getAllChannels()
  if (!channels.length) return ctx.reply('📭 لا توجد قنوات أو جروبات بعد.\nاستخدم /addchannel للإضافة')

  const buttons = channels.map(ch => {
    const icon = ch.status === 'live' ? '🟢' : ch.status === 'error' ? '🔴' : '⚪'
    return [Markup.button.callback(`${icon} ${ch.title}`, `ch_menu_${ch.id}`)]
  })
  buttons.push([Markup.button.callback('🔙 رجوع', 'main_menu')])
  ctx.replyWithMarkdown('📋 *القنوات والجروبات المضافة:*', Markup.inlineKeyboard(buttons))
}

// قائمة قناة/جروب واحد
bot.action(/^ch_menu_(.+)$/, adminOnly, ctx => {
  ctx.answerCbQuery()
  const chatId = ctx.match[1]
  const ch     = sm.getChannel(chatId)
  if (!ch) return ctx.reply('القناة غير موجودة')
  const icon = ch.status === 'live' ? '🟢' : ch.status === 'error' ? '🔴' : '⚪'
  ctx.replyWithMarkdown(
    `${icon} *${ch.title}*\n\n` +
    `الحالة: \`${ch.status}\`\n` +
    `المصدر: \`${ch.source || '—'}\`\n` +
    `مدة البث: \`${sm.getUptime(chatId)}\``,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🕋 مكة',    `stream_mecca_${chatId}`),
        Markup.button.callback('🕌 المدينة',`stream_madina_${chatId}`),
      ],
      [
        Markup.button.callback('⏹ إيقاف',       `stop_${chatId}`),
        Markup.button.callback('🔄 إعادة تشغيل',`restart_${chatId}`),
      ],
      [Markup.button.callback('🗑 حذف',         `delete_${chatId}`)],
      [Markup.button.callback('🔙 القائمة',     'list_channels')],
    ])
  )
})

bot.action(/^stream_mecca_(.+)$/,  adminOnly, ctx => {
  const chatId = ctx.match[1]
  ctx.answerCbQuery('⏳ جاري التشغيل...')
  const r = sm.startStream(chatId, SOURCES.mecca.url, 'best')
  ctx.reply(r.ok ? `✅ بدأ بث مكة في: ${sm.getChannel(chatId)?.title}` : `❌ ${r.msg}`)
})

bot.action(/^stream_madina_(.+)$/, adminOnly, ctx => {
  const chatId = ctx.match[1]
  ctx.answerCbQuery('⏳ جاري التشغيل...')
  const r = sm.startStream(chatId, SOURCES.madina.url, 'best')
  ctx.reply(r.ok ? `✅ بدأ بث المدينة في: ${sm.getChannel(chatId)?.title}` : `❌ ${r.msg}`)
})

bot.action(/^stop_(.+)$/,    adminOnly, ctx => {
  ctx.answerCbQuery('⏹ جاري الإيقاف...')
  const r = sm.stopStream(ctx.match[1])
  ctx.reply(r.ok ? '⏹ تم إيقاف البث' : `❌ ${r.msg}`)
})

bot.action(/^restart_(.+)$/, adminOnly, ctx => {
  ctx.answerCbQuery('🔄 جاري إعادة التشغيل...')
  sm.restartStream(ctx.match[1])
  ctx.reply('🔄 جاري إعادة التشغيل...')
})

bot.action(/^delete_(.+)$/, adminOnly, ctx => {
  ctx.answerCbQuery()
  const ch = sm.getChannel(ctx.match[1])
  sm.removeChannel(ctx.match[1])
  ctx.reply(`🗑 تم حذف: ${ch?.title}`)
})

// ══════════════════════════════════════
// أحداث StreamManager
// ══════════════════════════════════════
sm.on('streamError', (chatId, errMsg) => {
  const ch = sm.getChannel(chatId)
  ADMIN_IDS.forEach(id => {
    bot.telegram.sendMessage(id,
      `🔴 *خطأ في البث*\nالقناة: ${ch?.title || chatId}\nالخطأ: ${errMsg}\n\n_جاري إعادة التشغيل تلقائياً خلال 30 ثانية..._`,
      { parse_mode: 'Markdown' }
    ).catch(() => {})
  })
})

sm.on('streamStarted', chatId => {
  const ch = sm.getChannel(chatId)
  console.log(`🟢 Stream live: ${ch?.title}`)
})

// ══════════════════════════════════════
// تشغيل تلقائي عند البدء
// ══════════════════════════════════════
async function autoStart() {
  const channels = sm.getAllChannels()
  if (!channels.length) {
    console.log('⚠️ No channels yet. Add via bot.')
    return
  }
  console.log(`🔄 Auto-starting ${channels.length} streams...`)
  for (const ch of channels) {
    const src = ch.source || process.env.MECCA_STREAM_URL
    const r   = sm.startStream(ch.id, src, ch.quality || 'best')
    console.log(r.ok ? `✅ ${ch.title}` : `❌ ${ch.title}: ${r.msg}`)
    await new Promise(res => setTimeout(res, 2000))
  }
}

setTimeout(autoStart, 5000)

// ══════════════════════════════════════
// Dashboard API
// ══════════════════════════════════════
app.get('/api/status', (req, res) => {
  res.json({
    stats:    sm.getStats(),
    channels: sm.getAllChannels().map(ch => ({
      id:       ch.id,
      title:    ch.title,
      status:   ch.status,
      source:   ch.source || '—',
      uptime:   sm.getUptime(ch.id),
      quality:  ch.quality || '—',
    }))
  })
})

app.post('/api/start', (req, res) => {
  const { chatId, source } = req.body
  const url = source === 'madina' ? SOURCES.madina.url : SOURCES.mecca.url
  res.json(sm.startStream(chatId, url))
})

app.post('/api/stop', (req, res) => {
  res.json(sm.stopStream(req.body.chatId))
})

app.post('/api/restart', (req, res) => {
  res.json(sm.restartStream(req.body.chatId))
})

// ══════════════════════════════════════
// تشغيل السيرفر والبوت
// ══════════════════════════════════════
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`✅ Dashboard: http://localhost:${PORT}`))

bot.launch()
console.log('🤖 Bot started!')

process.once('SIGINT',  () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
