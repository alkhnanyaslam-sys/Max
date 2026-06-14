require('dotenv').config()
const ffmpeg = require('fluent-ffmpeg')
const { EventEmitter } = require('events')
const fs   = require('fs')
const path = require('path')

const FILE = path.join(__dirname, 'channels.json')

class StreamManager extends EventEmitter {
  constructor() {
    super()
    this.streams  = new Map()
    this.channels = new Map()
    this._loadChannels()
  }

  // ══════════════════════════════
  // تحميل القنوات من الملف
  // ══════════════════════════════
  _loadChannels() {
    try {
      if (fs.existsSync(FILE)) {
        const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
        data.forEach(ch => {
          this.channels.set(String(ch.id), { ...ch, status: 'idle', startedAt: null })
        })
        console.log(`✅ Loaded ${data.length} channels from file`)
      }
    } catch(e) {
      console.error('❌ Failed to load channels:', e.message)
    }
  }

  // ══════════════════════════════
  // حفظ القنوات للملف
  // ══════════════════════════════
  _saveChannels() {
    const data = Array.from(this.channels.values()).map(ch => ({
      id:       ch.id,
      title:    ch.title,
      rtmpUrl:  ch.rtmpUrl,
      streamKey:ch.streamKey,
      fullRtmp: ch.fullRtmp,
      addedAt:  ch.addedAt,
    }))
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2))
  }

  // ══════════════════════════════
  // إضافة قناة / جروب
  // ══════════════════════════════
  addChannel(chatId, chatTitle, rtmpUrl, streamKey) {
    this.channels.set(String(chatId), {
      id:        chatId,
      title:     chatTitle,
      rtmpUrl,
      streamKey,
      fullRtmp:  `${rtmpUrl}/${streamKey}`,
      addedAt:   new Date().toISOString(),
      status:    'idle',
      startedAt: null,
      source:    null,
      quality:   'best',
    })
    this._saveChannels()
  }

  removeChannel(chatId) {
    this.stopStream(chatId)
    this.channels.delete(String(chatId))
    this._saveChannels()
  }

  getChannel(chatId)  { return this.channels.get(String(chatId)) }
  getAllChannels()     { return Array.from(this.channels.values()) }

  // ══════════════════════════════
  // تشغيل البث
  // ══════════════════════════════
  startStream(chatId, sourceUrl, quality = 'best') {
    const ch = this.channels.get(String(chatId))
    if (!ch)                              return { ok: false, msg: 'القناة غير موجودة' }
    if (this.streams.has(String(chatId))) return { ok: false, msg: 'البث شغال بالفعل' }

    const qualityMap = {
      best:   ['-b:v', '4500k', '-s', '1920x1080'],
      medium: ['-b:v', '2500k', '-s', '1280x720'],
      low:    ['-b:v', '1000k', '-s', '854x480'],
    }
    const qArgs = qualityMap[quality] || qualityMap.best

    const proc = ffmpeg(sourceUrl)
      .inputOptions([
        '-re',
        '-stream_loop', '-1',
        '-user_agent', 'Mozilla/5.0',
      ])
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        ...qArgs,
        '-maxrate', '5000k',
        '-bufsize', '10000k',
        '-r', '30',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
      ])
      .output(ch.fullRtmp)
      .on('start', () => {
        ch.status    = 'live'
        ch.startedAt = new Date()
        ch.source    = sourceUrl
        ch.quality   = quality
        console.log(`🟢 Stream started: ${ch.title}`)
        this.emit('streamStarted', chatId)
      })
      .on('error', (err) => {
        console.error(`🔴 Stream error [${ch.title}]:`, err.message)
        ch.status = 'error'
        ch.error  = err.message
        this.streams.delete(String(chatId))
        this.emit('streamError', chatId, err.message)
        // إعادة تشغيل تلقائية بعد 30 ثانية
        setTimeout(() => {
          if (!this.streams.has(String(chatId))) {
            console.log(`🔄 Auto-restarting: ${ch.title}`)
            this.startStream(chatId, sourceUrl, quality)
          }
        }, 30000)
      })
      .on('end', () => {
        ch.status    = 'idle'
        ch.startedAt = null
        this.streams.delete(String(chatId))
        this.emit('streamEnded', chatId)
      })

    proc.run()
    this.streams.set(String(chatId), proc)
    return { ok: true }
  }

  // ══════════════════════════════
  // إيقاف البث
  // ══════════════════════════════
  stopStream(chatId) {
    const proc = this.streams.get(String(chatId))
    if (!proc) return { ok: false, msg: 'البث مش شغال' }
    try { proc.kill('SIGKILL') } catch(e) {}
    this.streams.delete(String(chatId))
    const ch = this.channels.get(String(chatId))
    if (ch) { ch.status = 'idle'; ch.startedAt = null }
    return { ok: true }
  }

  // ══════════════════════════════
  // إعادة تشغيل
  // ══════════════════════════════
  restartStream(chatId) {
    const ch = this.channels.get(String(chatId))
    if (!ch) return { ok: false, msg: 'القناة غير موجودة' }
    const source  = ch.source  || process.env.MECCA_STREAM_URL
    const quality = ch.quality || 'best'
    this.stopStream(chatId)
    setTimeout(() => this.startStream(chatId, source, quality), 3000)
    return { ok: true }
  }

  // ══════════════════════════════
  // إحصائيات
  // ══════════════════════════════
  getStats() {
    const all = this.getAllChannels()
    return {
      total: all.length,
      live:  all.filter(c => c.status === 'live').length,
      idle:  all.filter(c => c.status === 'idle').length,
      error: all.filter(c => c.status === 'error').length,
    }
  }

  getUptime(chatId) {
    const ch = this.channels.get(String(chatId))
    if (!ch || !ch.startedAt) return '—'
    const diff = Date.now() - new Date(ch.startedAt).getTime()
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }
}

module.exports = new StreamManager()
