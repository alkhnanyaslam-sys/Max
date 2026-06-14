require('dotenv').config()
const { Telegraf, Markup } = require('telegraf')
const express = require('express')
const path = require('path')
const sm = require('./streamManager')

const bot = new Telegraf(process.env.BOT_TOKEN)
const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'dashboard')))

const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(Number)
const SOURCES = {
  mecca: { name: '🕋 الحرم المكي',  url: process.env.MECCA_STREAM_URL },
  madina:{ name: '🕌 الحرم المدني', url: process.env.MADINA_STREAM_URL },
}

// ══════════════════════════════════════
// Middleware — أدمن فقط
// ══════════════════════════════════════
const adminOnly = (ctx, next) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('⛔ هذا الأمر للمسؤولين فقط')
  }
  return next()
}

// ══════════════════════════════════════
// لوحة التحكم الرئيسية
// ══════════════════════════════════════
const mainMenu = (ctx) => {
  const stats = sm.getStats()
  const text = `
🎛️ *لوحة التحكم — Ultra Stream Bot*

📊 *الإحصائيات:*
🟢 بث مباشر: \`${stats.live}\`
⚪ متوقف: \`${stats.idle}\`
🔴 خطأ: \`${stats.error}\`
📡 إجمالي القنوات: \`${stats.total}\`
  `.trim()

  return ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
    [
      Markup.button.callback('🕋 تشغيل مكة', 'start_mecca'),
      Markup.button.callback('🕌 تشغيل المدينة', 'start_madina'),
    ],
    [
      Markup.button.callback('⏹ إيقاف الكل', 'stop_all'),
      Markup.button.callback('🔄 إعادة تشغيل الكل', 'restart_all'),
    ],
    [
      Markup.button.callback('📋 قائمة القنوات', 'list_channels'),
      Markup.button.callback('➕ إضافة قناة', 'add_channel'),
    ],
    [
      Markup.button.callback('📊 الإحصائيات', 'stats'),
      Markup.button.callback('⚙️ الإعدادات', 'settings'),
    ],
  ]))
}

// ══════════════════════════════════════
// الأوامر
// ══════════════════════════════════════
bot.start(adminOnly, (ctx) => mainMenu(ctx))
bot.command('menu',  adminOnly, (ctx) => mainMenu(ctx))
bot.command('stats', adminOnly, (ctx) => {
  const stats = sm.getStats()
  const channels = sm.getAllChannels()
  let text = `📊 *الإحصائيات الكاملة*\n\n`
  text += `🟢 Live: ${stats.live} | ⚪ Idle: ${stats.idle} | 🔴 Error: ${stats.error}\n\n`
  channels.forEach(ch => {
    const icon = ch.status === 'live' ? '🟢' : ch.status === 'error' ? '🔴' : '⚪'
    text += `${icon} *${ch.title}*\n`
    text += `   المصدر: ${ch.source || '—'}\n`
    text += `   الوقت: \`${sm.getUptime(ch.id)}\`\n\n`
  })
  ctx.replyWithMarkdown(text)
})

// ══════════════════════════════════════
// إضافة قناة — بخطوات
// ══════════════════════════════════════
const addSteps = new Map()

bot.command('addchannel', adminOnly, (ctx) => {
  addSteps.set(ctx.from.id, { step: 1 })
  ctx.reply('📡 *إضافة قناة جديدة*\n\nأرسل Chat ID للقناة أو الجروب:\n(مثال: -1001234567890)', { parse_mode: 'Markdown' })
})

bot.action('add_channel', adminOnly, (ctx) => {
  ctx.answerCbQuery()
  addSteps.set(ctx.from.id, { step: 1 })
  ctx.reply('📡 *إضافة قناة جديدة*\n\nأرسل Chat ID للقناة أو الجروب:\n(مثال: -1001234567890)', { parse_mode: 'Markdown' })
})

bot.on('text', adminOnly, async (ctx) => {
  const userId = ctx.from.id
  const state = addSteps.get(userId)
  if (!state) return

  const text = ctx.message.text.trim()

  if (state.step === 1) {
    state.chatId = text
    state.step = 2
    addSteps.set(userId, state)
    return ctx.reply('✅ تم حفظ Chat ID\n\nأرسل اسم القناة/الجروب:')
  }

  if (state.step === 2) {
    state.title = text
    state.step = 3
    addSteps.set(userId, state)
    return ctx.reply('🔗 أرسل RTMP URL:\n(مثال: rtmp://a.rtmp.youtube.com/live2)')
  }

  if (state.step === 3) {
    state.rtmpUrl = text
    state.step = 4
    addSteps.set(userId, state)
    return ctx.reply('🔑 أرسل مفتاح البث (Stream Key) — سيبقى خاصاً 🔒')
  }

  if (state.step === 4) {
    state.streamKey = text
    addSteps.delete(userId)

    sm.addChannel(state.chatId, state.title, state.rtmpUrl, state.streamKey)

    // حذف رسالة المفتاح فوراً للأمان
    await ctx.deleteMessage()

    ctx.replyWithMarkdown(
      `✅ *تمت إضافة القناة بنجاح!*\n\n` +
      `📺 الاسم: \`${state.title}\`\n` +
      `🆔 Chat ID: \`${state.chatId}\`\n` +
      `🔒 مفتاح البث: محمي`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🕋 بث مكة الآن', `stream_mecca_${state.chatId}`)],
        [Markup.button.callback('🕌 بث المدينة الآن', `stream_madina_${state.chatId}`)],
        [Markup.button.callback('🔙 القائمة الرئيسية', 'main_menu')],
      ])
    )
  }
})

// ══════════════════════════════════════
// Actions — أزرار inline
// ══════════════════════════════════════
bot.action('main_menu', (ctx) => { ctx.answerCbQuery(); mainMenu(ctx) })

bot.action('start_mecca', adminOnly, async (ctx) => {
  ctx.answerCbQuery('⏳ جاري تشغيل بث مكة...')
  const channels = sm.getAllChannels()
  if (!channels.length) return ctx.reply('⚠️ لا توجد قنوات مضافة. أضف قناة أولاً.')

  let results = ''
  for (const ch of channels) {
    const r = sm.startStream(ch.id, SOURCES.mecca.url, 'best')
    results += r.ok ? `✅ ${ch.title}\n` : `❌ ${ch.title}: ${r.msg}\n`
  }
  ctx.replyWithMarkdown(`🕋 *بث الحرم المكي*\n\n${results}`)
})

bot.action('start_madina', adminOnly, async (ctx) => {
  ctx.answerCbQuery('⏳ جاري تشغيل بث المدينة...')
  const channels = sm.getAllChannels()
  if (!channels.length) return ctx.reply('⚠️ لا توجد قنوات مضافة.')

  let results = ''
  for (const ch of channels) {
    const r = sm.startStream(ch.id, SOURCES.madina.url, 'best')
    results += r.ok ? `✅ ${ch.title}\n` : `❌ ${ch.title}: ${r.msg}\n`
  }
  ctx.replyWithMarkdown(`🕌 *بث الحرم المدني*\n\n${results}`)
})

bot.action('stop_all', adminOnly, (ctx) => {
  ctx.answerCbQuery('⏹ جاري الإيقاف...')
  const channels = sm.getAllChannels()
  channels.forEach(ch => sm.stopStream(ch.id))
  ctx.reply(`⏹ تم إيقاف جميع البثوث (${channels.length} قناة)`)
})

bot.action('restart_all', adminOnly, (ctx) => {
  ctx.answerCbQuery('🔄 جاري إعادة التشغيل...')
  const channels = sm.getAllChannels()
  channels.forEach(ch => sm.restartStream(ch.id))
  ctx.reply(`🔄 جاري إعادة تشغيل ${channels.length} قناة...`)
})

bot.action('list_channels', adminOnly, (ctx) => {
  ctx.answerCbQuery()
  const channels = sm.getAllChannels()
  if (!channels.length) return ctx.reply('📭 لا توجد قنوات مضافة بعد.')

  const buttons = channels.map(ch => {
    const icon = ch.status === 'live' ? '🟢' : ch.status === 'error' ? '🔴' : '⚪'
    return [Markup.button.callback(`${icon} ${ch.title} — ${sm.getUptime(ch.id)}`, `ch_menu_${ch.id}`)]
  })
  buttons.push([Markup.button.callback('🔙 رجوع', 'main_menu')])

  ctx.replyWithMarkdown('📋 *قائمة القنوات:*', Markup.inlineKeyboard(buttons))
})

bot.action('stats', adminOnly, (ctx) => {
  ctx.answerCbQuery()
  const stats = sm.getStats()
  ctx.replyWithMarkdown(
    `📊 *الإحصائيات*\n\n` +
    `🟢 بث مباشر: \`${stats.live}\`\n` +
    `⚪ متوقف: \`${stats.idle}\`\n` +
    `🔴 خطأ: \`${stats.error}\`\n` +
    `📡 الإجمالي: \`${stats.total}\``
  )
})

// قائمة قناة واحدة
bot.action(/ch_menu_(.+)/, adminOnly, (ctx) => {
  ctx.answerCbQuery()
  const chatId = ctx.match[1]
  const ch = sm.getChannel(chatId)
  if (!ch) return ctx.reply('القناة غير موجودة')

  const icon = ch.status === 'live' ? '🟢' : ch.status === 'error' ? '🔴' : '⚪'
  ctx.replyWithMarkdown(
    `${icon} *${ch.title}*\n\n` +
    `الحالة: \`${ch.status}\`\n` +
    `المصدر: \`${ch.source || '—'}\`\n` +
    `مدة البث: \`${sm.getUptime(chatId)}\``,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🕋 مكة', `stream_mecca_${chatId}`),
        Markup.button.callback('🕌 المدينة', `stream_madina_${chatId}`),
      ],
      [
        Markup.button.callback('⏹ إيقاف', `stop_${chatId}`),
        Markup.button.callback('🔄 إعادة', `restart_${chatId}`),
      ],
      [Markup.button.callback('🗑 حذف القناة', `delete_${chatId}`)],
      [Markup.button.callback('🔙 القائمة', 'list_channels')],
    ])
  )
})

bot.action(/stream_mecca_(.+)/, adminOnly, (ctx) => {
  const chatId = ctx.match[1]
  ctx.answerCbQuery('⏳ جاري التشغيل...')
  const r = sm.startStream(chatId, SOURCES.mecca.url, 'best')
  ctx.reply(r.ok ? `✅ بدأ بث مكة في ${sm.getChannel(chatId)?.title}` : `❌ ${r.msg}`)
})

bot.action(/stream_madina_(.+)/, adminOnly, (ctx) => {
  const chatId = ctx.match[1]
  ctx.answerCbQuery('⏳ جاري التشغيل...')
  const r = sm.startStream(chatId, SOURCES.madina.url, 'best')
  ctx.reply(r.ok ? `✅ بدأ بث المدينة في ${sm.getChannel(chatId)?.title}` : `❌ ${r.msg}`)
})

bot.action(/stop_(.+)/, adminOnly, (ctx) => {
  const chatId = ctx.match[1]
  ctx.answerCbQuery('⏹ جاري الإيقاف...')
  const r = sm.stopStream(chatId)
  ctx.reply(r.ok ? `⏹ تم إيقاف البث` : `❌ ${r.msg}`)
})

bot.action(/restart_(.+)/, adminOnly, (ctx) => {
  const chatId = ctx.match[1]
  ctx.answerCbQuery('🔄 جاري إعادة التشغيل...')
  sm.restartStream(chatId)
  ctx.reply('🔄 جاري إعادة التشغيل...')
})

bot.action(/delete_(.+)/, adminOnly, (ctx) => {
  const chatId = ctx.match[1]
  ctx.answerCbQuery()
  const ch = sm.getChannel(chatId)
  sm.removeChannel(chatId)
  ctx.reply(`🗑 تم حذف القناة: ${ch?.title}`)
})

// ══════════════════════════════════════
// أحداث StreamManager
// ══════════════════════════════════════
sm.on('streamError', (chatId, errMsg) => {
  const ch = sm.getChannel(chatId)
  ADMIN_IDS.forEach(id => {
    bot.telegram.sendMessage(id,
      `🔴 *خطأ في البث*\n\nالقناة: ${ch?.title || chatId}\nالخطأ: ${errMsg}`,
      { parse_mode: 'Markdown' }
    )
  })
})

sm.on('streamEnded', (chatId) => {
  const ch = sm.getChannel(chatId)
  ADMIN_IDS.forEach(id => {
    bot.telegram.sendMessage(id, `⚪ انتهى البث في: ${ch?.title || chatId}`)
  })
})

// ══════════════════════════════════════
// Dashboard Web
// ══════════════════════════════════════
app.get('/api/status', (req, res) => {
  res.json({
    stats: sm.getStats(),
    channels: sm.getAllChannels().map(ch => ({
      ...ch,
      streamKey: '🔒 محمي',
      uptime: sm.getUptime(ch.id)
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

// ══════════════════════════════════════
// تشغيل
// ══════════════════════════════════════
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`✅ Dashboard: http://localhost:${PORT}`))
bot.launch()
console.log('🤖 Bot started!')

process.once('SIGINT',  () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
