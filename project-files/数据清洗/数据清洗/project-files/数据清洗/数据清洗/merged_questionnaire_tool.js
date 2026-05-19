// ==================== 全局变量 ====================
let rawData = null
let rawHeaders = []
let uploadedData = []
let cleanData = []
let removedData = []
let markedData = []
let cleaningLogs = []
let ruleStats = {}
let rawHeaderRows = []  // 保存双行表头（如果有）
let answerPathGroups = []  // 上传后自动识别的作答题项分组
let detectedCoreBases = []  // 上传后识别出的公共题（base级）
let detectedQuestionItems = []  // 上传后识别出的全部题项
let questionItemsConfirmed = false  // 题项是否已由用户确认
let questionItemDisplayList = []  // 用于确认面板展示的题项（含多选聚合说明）
let iqrCalibrationResult = null  // IQR校准结果缓存
let iqrCalibrationConfirmed = false  // IQR校准是否已由用户确认
let confirmedIqrK = 1.5  // 用户确认的IQR倍数k

// ==================== DOM 元素 ====================
const uploadArea = document.getElementById('uploadArea')
const fileInput = document.getElementById('fileInput')
const startCleanBtn = document.getElementById('startCleanBtn')

// ==================== Toast ====================
function showToast(message) {
  const toast = document.getElementById('toast')
  toast.textContent = message
  toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 3000)
}

// ==================== 文件上传 ====================
uploadArea.addEventListener('click', () => fileInput.click())

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault()
  uploadArea.classList.add('bg-white/40')
})

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('bg-white/40')
})

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault()
  uploadArea.classList.remove('bg-white/40')
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0])
})

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0])
})

function handleFile(file) {
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      rawData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 })

      // 检测双行表头（第一行简写，第二行完整）
      const headerResult = detectDoubleRowHeaders(rawData)
      if (headerResult.hasDoubleHeaders) {
        addLog(`检测到双行表头，使用第二行作为列名`)
        rawHeaders = headerResult.headers
        rawHeaderRows = [rawData[0], rawData[1]]  // 保存双行表头
        uploadedData = rawData.slice(2).map((row, idx) => {
          const obj = { _rowIndex: idx + 3 }
          rawHeaders.forEach((h, i) => obj[h] = row[i])
          return obj
        })
      } else {
        // 单行表头，正常使用第一行
        rawHeaders = rawData[0]
        rawHeaderRows = [rawData[0]]  // 只保存单行表头
        uploadedData = rawData.slice(1).map((row, idx) => {
          const obj = { _rowIndex: idx + 2 }
          rawHeaders.forEach((h, i) => obj[h] = row[i])
          return obj
        })
      }

      document.getElementById('fileName').classList.remove('hidden')
      document.getElementById('fileName').innerHTML = `已上传：${file.name}`
      document.getElementById('fileStats').classList.remove('hidden')
      document.getElementById('fileStats').innerHTML = `行数: ${uploadedData.length} | 列数: ${rawHeaders.length}`
      document.getElementById('totalCount').innerText = uploadedData.length

      // 上传后先识别题项，等待用户确认后再进入下一步
      detectedQuestionItems = rawHeaders.filter(h => isQuestionColumnName(h))
      questionItemDisplayList = buildQuestionItemDisplayList(detectedQuestionItems)
      questionItemsConfirmed = false
      answerPathGroups = []
      detectedCoreBases = []
      startCleanBtn.disabled = true
      renderQuestionItemsConfirmPanel()

      showToast('文件上传成功，请先确认题项')
      addLog(`成功读取文件：${file.name}`)
      addLog(`样本量：${uploadedData.length}，列数：${rawHeaders.length}`)
      addLog(`识别到问卷题项：${detectedQuestionItems.length}个，等待确认`)
    } catch (err) {
      showToast('文件解析失败: ' + err.message)
    }
  }
  reader.readAsArrayBuffer(file)
}

// 检测双行表头（第一行简写如A3，第二行完整如A3__1）
function detectDoubleRowHeaders(data) {
  if (data.length < 3) return { hasDoubleHeaders: false, headers: data[0] }

  const firstRow = data[0]
  const secondRow = data[1]

  // 检查是否第一行是简写，第二行是展开格式（如 A3 vs A3__1）
  // 特征：第二行列名包含__或比第一行更详细
  let expandedCount = 0
  let sameCount = 0

  for (let i = 0; i < Math.min(firstRow.length, secondRow.length); i++) {
    const first = String(firstRow[i] || '').trim()
    const second = String(secondRow[i] || '').trim()

    if (first === second) {
      sameCount++
    } else if (second.startsWith(first) && second.includes('__')) {
      // 第二行是第一行的展开形式（如 A3__1 以 A3 开头）
      expandedCount++
    }
  }

  // 如果第二行有很多展开列名，认为是双行表头
  const hasDoubleHeaders = expandedCount > 5 || (expandedCount > 0 && sameCount < firstRow.length * 0.5)

  if (hasDoubleHeaders) {
    return { hasDoubleHeaders: true, headers: secondRow }
  }

  return { hasDoubleHeaders: false, headers: firstRow }
}

// ==================== Excel日期转换 ====================
function excelDateToJSDate(serial) {
  if (!serial) return null
  if (serial instanceof Date) return serial
  if (typeof serial === 'string' && (serial.includes('-') || serial.includes('/'))) {
    const d = new Date(serial)
    return isNaN(d.getTime()) ? null : d
  }
  const num = parseFloat(serial)
  if (!isNaN(num) && num > 30000 && num < 60000) {
    return new Date((num - 25569) * 86400 * 1000)
  }
  return null
}

// ==================== Tab切换 ====================
function switchTab(tab, event) {
  document.getElementById('overviewTab').classList.add('hidden-tab')
  document.getElementById('logTab').classList.add('hidden-tab')
  document.getElementById('removedTab').classList.add('hidden-tab')
  document.getElementById('markedTab').classList.add('hidden-tab')

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-[#8C9EAF]', 'text-white')
    btn.classList.add('bg-[#F5F2EE]')
  })

  event.target.classList.remove('bg-[#F5F2EE]')
  event.target.classList.add('bg-[#8C9EAF]', 'text-white')

  if (tab === 'overview') {
    document.getElementById('overviewTab').classList.remove('hidden-tab')
  } else if (tab === 'log') {
    document.getElementById('logTab').classList.remove('hidden-tab')
  } else if (tab === 'removed') {
    document.getElementById('removedTab').classList.remove('hidden-tab')
  } else if (tab === 'marked') {
    document.getElementById('markedTab').classList.remove('hidden-tab')
  }
}

// ==================== 日志功能 ====================
function addLog(text) {
  cleaningLogs.push({ message: text, time: new Date() })
  const div = document.createElement('div')
  div.className = 'bg-white border border-[#ECE4DA] rounded-2xl p-4'
  div.innerHTML = `<span class="text-[#A59D93] text-xs">${new Date().toLocaleTimeString()}</span> ${text}`
  const logContent = document.getElementById('logContent')
  if (logContent.querySelector('.text-\\[\\#8F877C\\]')) {
    logContent.innerHTML = ''
  }
  logContent.prepend(div)
}

// ==================== 规则项操作 ====================
function removeItem(btn) {
  btn.closest('.small-card').remove()
}

function addAnchor() {
  const div = document.createElement('div')
  div.className = 'small-card'
  div.innerHTML = `
    <div class="flex gap-2">
      <input class="input flex-1 anchor-question" placeholder="题号 (如: A3__3)">
      <input class="input flex-1 anchor-answer" placeholder="正确答案 (如: 1)">
      <button class="remove-btn" onclick="removeItem(this)">✕</button>
    </div>
  `
  document.getElementById('anchorList').appendChild(div)
}

function addLogic() {
  const div = document.createElement('div')
  div.className = 'small-card'
  div.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <input class="input logic-q1" placeholder="题号A (如: A3__1)">
      <input class="input logic-a1" placeholder="答案A (如: 1)">
    </div>
    <div class="text-center text-xs text-[#B2A99F] my-2">
      与以下答案矛盾
    </div>
    <div class="grid grid-cols-2 gap-3">
      <input class="input logic-q2" placeholder="题号B (如: A3__2)">
      <input class="input logic-a2" placeholder="答案B (如: 2)">
      <button class="remove-btn" onclick="removeItem(this)">✕</button>
    </div>
  `
  document.getElementById('logicList').appendChild(div)
}

function renderQuestionItemsConfirmPanel() {
  const panel = document.getElementById('questionConfirmPanel')
  const summary = document.getElementById('questionConfirmSummary')
  const list = document.getElementById('questionConfirmList')
  const btn = document.getElementById('confirmQuestionsBtn')
  if (!panel || !summary || !list || !btn) return

  panel.classList.remove('hidden')
  btn.disabled = detectedQuestionItems.length === 0
  btn.textContent = detectedQuestionItems.length === 0 ? '未识别到题项' : '✅ 确认题项并继续'

  summary.textContent = `共识别 ${detectedQuestionItems.length} 个问卷题项，请确认后继续。双下划线“__数字”表示多选题选项序号。`

  if (detectedQuestionItems.length === 0) {
    list.innerHTML = '<div class="text-[#A49B91] text-xs">未识别到题项，请检查表头命名。</div>'
    return
  }

  const displayItems = questionItemDisplayList.length > 0 ? questionItemDisplayList : detectedQuestionItems
  list.innerHTML = displayItems
    .map(item => `<span class="inline-block px-2 py-1 rounded-lg bg-[#F5F2EE] border border-[#ECE4DA] text-xs mr-2 mb-2">${item}</span>`)
    .join('')
}

function confirmQuestionItems() {
  if (!uploadedData || uploadedData.length === 0) {
    showToast('请先上传有效数据文件')
    return
  }

  if (!detectedQuestionItems || detectedQuestionItems.length === 0) {
    showToast('未识别到题项，无法确认')
    return
  }

  questionItemsConfirmed = true

  const btn = document.getElementById('confirmQuestionsBtn')
  if (btn) {
    btn.disabled = true
    btn.textContent = '✅ 已确认题项'
  }

  answerPathGroups = analyzeAnswerPathGroups(uploadedData, rawHeaders)
  renderAnswerPathGroups(uploadedData.length)
  addLog(`题项确认完成：${detectedQuestionItems.length}个`)
  addLog(`作答题项分组识别完成：共 ${answerPathGroups.length} 组`)

  // 根据 IQR 开关状态决定是否展示 IQR 校准面板并要求确认
  const iqrToggle = document.getElementById('iqrDurationToggle')
  if (iqrToggle && iqrToggle.checked) {
    renderIqrConfirmPanel()
    showToast('题项确认成功，请在右侧规则区确认IQR时长校准')
  } else {
    startCleanBtn.disabled = false
    showToast('题项确认成功，已进入下一步')
  }
}

// ==================== IQR校准确认面板 ====================
function toggleIqrRule() {
  const isEnabled = document.getElementById('iqrDurationToggle')?.checked
  const panel = document.getElementById('iqrConfirmPanel')
  const waitingText = document.getElementById('iqrWaitingText')
  
  if (!isEnabled) {
    if (panel) panel.classList.add('hidden')
    if (waitingText) waitingText.classList.add('hidden')
    // 如果关闭了IQR规则，就不再需要它的强制确认，且如果题项已确认则允许清洗
    if (questionItemsConfirmed) {
      startCleanBtn.disabled = false
    }
  } else {
    // 开启了IQR规则
    if (questionItemsConfirmed) {
      if (waitingText) waitingText.classList.add('hidden')
      renderIqrConfirmPanel()
      // 此时开启了IQR但还未点击面板上的确认，应该阻断清洗
      if (!iqrCalibrationConfirmed) {
        startCleanBtn.disabled = true
      }
    } else {
      if (waitingText) waitingText.classList.remove('hidden')
      if (panel) panel.classList.add('hidden')
    }
  }
}

function renderIqrConfirmPanel() {
  const panel = document.getElementById('iqrConfirmPanel')
  const summary = document.getElementById('iqrConfirmSummary')
  const detail = document.getElementById('iqrConfirmDetail')
  const btn = document.getElementById('confirmIqrBtn')
  const waitingText = document.getElementById('iqrWaitingText')
  if (!panel || !summary || !detail || !btn) return

  if (waitingText) waitingText.classList.add('hidden')
  panel.classList.remove('hidden')

  const questionCols = rawHeaders.filter(h => isQuestionColumnName(h))

  // 计算IQR校准
  iqrCalibrationResult = buildIqrCalibrationFromCore(uploadedData, questionCols)
  confirmedIqrK = parseFloat(document.getElementById('iqrKInput')?.value) || 1.5

  const cal = iqrCalibrationResult
  const iqr = cal.q3 - cal.q1

  // 摘要
  summary.textContent = `公共题base: ${cal.coreBaseCount}个 | 锚定样本: ${cal.anchorCount}个 | 校准来源: ${cal.source}`

  // 详情
  renderIqrDetail(cal, confirmedIqrK)

  addLog(
    `IQR校准确认: Q1=${cal.q1.toFixed(2)}秒/工作量, Q3=${cal.q3.toFixed(2)}秒/工作量, IQR=${iqr.toFixed(2)}, k=${confirmedIqrK}, 合理范围=${Math.max(cal.q1 - confirmedIqrK * iqr, 0.5).toFixed(2)}~${(cal.q3 + confirmedIqrK * iqr).toFixed(2)}秒/工作量`
  )
}

function renderIqrDetail(cal, k) {
  const detail = document.getElementById('iqrConfirmDetail')
  if (!detail) return

  const iqr = cal.q3 - cal.q1
  const minPerWorkload = Math.max(cal.q1 - k * iqr, 0.5)
  const maxPerWorkload = cal.q3 + k * iqr

  // 示例工作量值
  const exampleWorkloads = [5, 10, 20, 30, 50]

  detail.innerHTML = `
    <div class="grid grid-cols-2 gap-2">
      <div class="bg-white rounded-xl p-2 border border-[#ECE4DA]">
        <span class="text-[#A59D93]">Q1 (25%分位): </span>
        <span class="font-semibold">${cal.q1.toFixed(2)} 秒/工作量</span>
      </div>
      <div class="bg-white rounded-xl p-2 border border-[#ECE4DA]">
        <span class="text-[#A59D93]">Q3 (75%分位): </span>
        <span class="font-semibold">${cal.q3.toFixed(2)} 秒/工作量</span>
      </div>
      <div class="bg-white rounded-xl p-2 border border-[#ECE4DA]">
        <span class="text-[#A59D93]">IQR: </span>
        <span class="font-semibold">${iqr.toFixed(2)} 秒/工作量</span>
      </div>
      <div class="bg-white rounded-xl p-2 border border-[#ECE4DA]">
        <span class="text-[#A59D93]">k值: </span>
        <span class="font-semibold">${k}</span>
      </div>
    </div>
    <div class="bg-white rounded-xl p-3 border border-[#ECE4DA] mt-2">
      <div class="text-[#A59D93] mb-2">合理时长范围（k=${k}）：<span class="font-semibold text-[#6B6B6B]">${minPerWorkload.toFixed(2)} ~ ${maxPerWorkload.toFixed(2)} 秒/工作量</span></div>
      <div class="space-y-1">
        ${exampleWorkloads.map(w => {
          const minSec = (w * minPerWorkload).toFixed(0)
          const maxSec = (w * maxPerWorkload).toFixed(0)
          const minMin = (w * minPerWorkload / 60).toFixed(1)
          const maxMin = (w * maxPerWorkload / 60).toFixed(1)
          return `<div class="text-[#8F877C]">工作量=${w} → 合理 ${minSec}~${maxSec}秒（${minMin}~${maxMin}分钟）</div>`
        }).join('')}
      </div>
    </div>
  `
}

function updateIqrPreview() {
  if (!iqrCalibrationResult) return
  const k = parseFloat(document.getElementById('iqrKInput')?.value) || 1.5
  confirmedIqrK = k
  renderIqrDetail(iqrCalibrationResult, k)
}

function confirmIqrCalibration() {
  if (!iqrCalibrationResult) {
    showToast('IQR校准数据未就绪，请重试')
    return
  }

  confirmedIqrK = parseFloat(document.getElementById('iqrKInput')?.value) || 1.5
  iqrCalibrationConfirmed = true
  startCleanBtn.disabled = false

  const btn = document.getElementById('confirmIqrBtn')
  if (btn) {
    btn.disabled = true
    btn.textContent = '✅ 已确认IQR校准'
  }

  const cal = iqrCalibrationResult
  const iqr = cal.q3 - cal.q1
  const minPerWorkload = Math.max(cal.q1 - confirmedIqrK * iqr, 0.5)
  const maxPerWorkload = cal.q3 + confirmedIqrK * iqr

  addLog(
    `IQR校准已确认: Q1=${cal.q1.toFixed(2)}, Q3=${cal.q3.toFixed(2)}, IQR=${iqr.toFixed(2)}, k=${confirmedIqrK}, 合理范围=${minPerWorkload.toFixed(2)}~${maxPerWorkload.toFixed(2)}秒/工作量`
  )
  showToast('IQR校准已确认，请点击"开始数据清洗"')
}

function buildQuestionItemDisplayList(questionItems) {
  const baseOptionMap = {}
  const singleItems = []

  questionItems.forEach(item => {
    const raw = String(item || '').trim()
    const parts = raw.split('__')

    // 无双下划线：普通题直接展示
    if (parts.length === 1) {
      singleItems.push(raw)
      return
    }

    const base = parts[0]
    const optionToken = parts[1]

    // __数字 视为多选选项
    if (/^\d+$/.test(optionToken)) {
      if (!baseOptionMap[base]) baseOptionMap[base] = []
      baseOptionMap[base].push(parseInt(optionToken, 10))

      // 同时保留 open 字段作为附加说明
      if (parts[2] === 'open') {
        if (!baseOptionMap[base + '__open']) baseOptionMap[base + '__open'] = []
      }
      return
    }

    // 其他后缀（如 __open）保留原样展示
    singleItems.push(raw)
  })

  const groupedItems = Object.entries(baseOptionMap)
    .filter(([k]) => !k.endsWith('__open'))
    .map(([base, nums]) => {
      const uniqSorted = [...new Set(nums)].sort((a, b) => a - b)
      const min = uniqSorted[0]
      const max = uniqSorted[uniqSorted.length - 1]
      const openTag = baseOptionMap[base + '__open'] !== undefined ? '（含open）' : ''
      return `${base}__${min}~${base}__${max}（多选题${uniqSorted.length}个选项）${openTag}`
    })

  return [...singleItems.sort(), ...groupedItems.sort()]
}

function analyzeAnswerPathGroups(data, headers) {
  const questionCols = (headers || []).filter(h => isQuestionColumnName(h))
  if (!data || data.length === 0 || questionCols.length === 0) return []

  const coreCoverageThreshold = 0.95
  const coverageCount = {}

  data.forEach(row => {
    const baseSet = new Set(
      questionCols
        .filter(col => isAnsweredValue(row[col]))
        .map(col => toBaseQuestionId(col))
    )
    baseSet.forEach(base => {
      coverageCount[base] = (coverageCount[base] || 0) + 1
    })
  })

  const coreSet = new Set(
    Object.keys(coverageCount).filter(base => (coverageCount[base] / data.length) >= coreCoverageThreshold)
  )
  detectedCoreBases = [...coreSet].sort()

  const groupMap = {}

  data.forEach((row, idx) => {
    const answeredBases = [...new Set(
      questionCols
        .filter(col => isAnsweredValue(row[col]))
        .map(col => toBaseQuestionId(col))
    )].sort()

    const variableBases = answeredBases.filter(base => !coreSet.has(base)).sort()
    const key = variableBases.length > 0 ? variableBases.join('|') : '__core_only__'

    if (!groupMap[key]) {
      groupMap[key] = {
        key,
        variableBases,
        members: [],
        answeredCountTotal: 0,
        allAnsweredBaseSet: new Set(),
        sampleRowIndex: idx
      }
    }

    groupMap[key].members.push(row)
    groupMap[key].answeredCountTotal += answeredBases.length
    answeredBases.forEach(base => groupMap[key].allAnsweredBaseSet.add(base))
  })

  return Object.values(groupMap)
    .map((group, i) => {
      const size = group.members.length
      const avgAnsweredCount = size > 0 ? group.answeredCountTotal / size : 0
      return {
        id: i + 1,
        key: group.key,
        size,
        percent: (size / data.length) * 100,
        avgAnsweredCount,
        variableBases: group.variableBases,
        allAnsweredBases: [...group.allAnsweredBaseSet].sort()
      }
    })
    .sort((a, b) => b.size - a.size)
}

function renderAnswerPathGroups(totalCount) {
  const container = document.getElementById('coreBaseResult')
  if (!container) return

  if (!detectedCoreBases || detectedCoreBases.length === 0) {
    container.innerHTML = `
      <div class="bg-white border border-[#ECE4DA] rounded-xl px-4 py-3 text-xs text-[#8F877C] mt-3">
        未识别到公共必答题
      </div>
    `
    return
  }

  const topCore = (detectedCoreBases || []).slice(0, 15)
  const coreExtraCount = Math.max((detectedCoreBases || []).length - topCore.length, 0)
  const coreLabel = topCore.join('、') + (coreExtraCount > 0 ? ` 等${detectedCoreBases.length}项` : '')

  container.innerHTML = `
    <div class="mt-4 pt-3 border-t border-[#ECE4DA]">
      <div class="bg-white border border-[#ECE4DA] rounded-xl px-3 py-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-[#6B6B6B] text-xs font-medium">公共必答题识别</span>
          <span class="text-[10px] bg-[#EEF2F5] px-2 py-0.5 rounded text-[#73828F]">覆盖率≥95%</span>
        </div>
        <div class="text-[11px] text-[#8F877C]">题项：${coreLabel}</div>
      </div>
    </div>
  `
}

// ==================== 数据清洗 ====================
function startCleaning() {
  try {
    console.log('startCleaning called')
    if (!uploadedData || uploadedData.length === 0) {
      showToast('请先上传有效数据文件')
      return
    }

    if (!questionItemsConfirmed) {
      showToast('请先确认识别到的题项，再开始清洗')
      addLog('阻断：题项未确认，无法开始清洗')
      return
    }

    const config = getConfig()

    if (config.iqrDurationToggle && !iqrCalibrationConfirmed) {
      showToast('请先在答题时长检测中确认IQR时长校准，再开始清洗')
      addLog('阻断：IQR校准未确认，无法开始清洗')
      return
    }

    cleanData = []
    removedData = []
    markedData = []
    ruleStats = {}
    cleaningLogs = []
    document.getElementById('logContent').innerHTML = ''

    addLog('========== 开始数据清洗 ==========')

    console.log('config:', config)
    let data = [...uploadedData]
    const totalCount = data.length

    // 步骤1: 答题时长检测
    addLog('步骤1启动: 答题时长检测')
    const durationResult = checkDuration(data, config)
    data = durationResult.valid
    removedData.push(...durationResult.removed)
    ruleStats['答题时长'] = durationResult.removed.length
    addLog(`步骤1完成: 答题时长检测 - 剔除 ${durationResult.removed.length} 人`)

    // 步骤2: 锚定题检测
    if (config.anchors.length > 0) {
      addLog('步骤2启动: 锚定题检测')
      const anchorResult = checkAnchorQuestions(data, config)
      data = anchorResult.valid
      removedData.push(...anchorResult.removed)
      ruleStats['锚定题'] = anchorResult.removed.length
      addLog(`步骤2完成: 锚定题检测 - 剔除 ${anchorResult.removed.length} 人`)
    } else {
      addLog('步骤2跳过: 未配置锚定题')
    }

    // 步骤3: 逻辑矛盾检测
    if (config.logicRules.length > 0) {
      addLog('步骤3启动: 逻辑矛盾检测')
      const logicResult = checkLogicConflict(data, config)
      data = logicResult.valid
      removedData.push(...logicResult.removed)
      ruleStats['逻辑矛盾'] = logicResult.removed.length
      addLog(`步骤3完成: 逻辑矛盾检测 - 剔除 ${logicResult.removed.length} 人`)
    } else {
      addLog('步骤3跳过: 未配置逻辑矛盾规则')
    }

    // 步骤4: 直线作答检测
    addLog('步骤4启动: 直线作答检测')
    const straightResult = checkStraightAnswers(data, config)
    data = straightResult.valid
    markedData.push(...straightResult.marked)
    ruleStats['直线作答'] = straightResult.marked.length
    addLog(`步骤4完成: 直线作答检测 - 标记 ${straightResult.marked.length} 人`)

    // 步骤5: 规律作答检测
    addLog('步骤5启动: 规律作答检测')
    const patternResult = checkPatternAnswers(data, config)
    data = patternResult.valid
    removedData.push(...patternResult.removed)
    ruleStats['规律作答'] = patternResult.removed.length
    addLog(`步骤5完成: 规律作答检测 - 剔除 ${patternResult.removed.length} 人`)

    // 步骤6: IP重复检测
    if (config.enableDuplicateIP) {
      addLog('步骤6启动: IP重复检测')
      const ipResult = checkDuplicateIP(data)
      data = ipResult.valid
      removedData.push(...ipResult.removed)
      ruleStats['IP重复'] = ipResult.removed.length
      addLog(`步骤6完成: IP重复检测 - 剔除 ${ipResult.removed.length} 人`)
    } else {
      addLog('步骤6跳过: IP重复检测已关闭')
    }

    // 步骤7: 设备重复检测
    if (config.enableDuplicateDevice) {
      addLog('步骤7启动: 设备重复检测')
      const deviceResult = checkDuplicateDevice(data)
      data = deviceResult.valid
      removedData.push(...deviceResult.removed)
      ruleStats['设备重复'] = deviceResult.removed.length
      addLog(`步骤7完成: 设备重复检测 - 剔除 ${deviceResult.removed.length} 人`)
    } else {
      addLog('步骤7跳过: 设备重复检测已关闭')
    }

    // 步骤8: 联系方式重复检测
    if (config.enableDuplicateContact) {
      addLog('步骤8启动: 联系方式重复检测')
      const contactResult = checkDuplicateContact(data)
      data = contactResult.valid
      removedData.push(...contactResult.removed)
      ruleStats['联系方式重复'] = contactResult.removed.length
      addLog(`步骤8完成: 联系方式重复检测 - 剔除 ${contactResult.removed.length} 人`)
    } else {
      addLog('步骤8跳过: 联系方式重复检测已关闭')
    }

    cleanData = data

    // 更新统计
    document.getElementById('validCount').innerText = cleanData.length
    document.getElementById('removedCount').innerText = removedData.length
    document.getElementById('markedCount').innerText = markedData.length

    renderRuleStats(totalCount)
    renderRemovedTable()
    renderMarkedTable()

    addLog('========== 数据清洗完成 ==========')
    addLog(`有效: ${cleanData.length} 条 | 剔除: ${removedData.length} 条 | 标记: ${markedData.length} 条`)
    showToast('清洗完成！')
  } catch (err) {
    console.error('清洗出错:', err)
    showToast('清洗出错: ' + err.message)
    addLog('错误: ' + err.message)
  }
}

function getConfig() {
  const anchors = []
  document.querySelectorAll('.anchor-question').forEach((q, i) => {
    const a = document.querySelectorAll('.anchor-answer')[i]
    if (q.value && a.value) {
      anchors.push({ question: q.value.trim(), answer: a.value.trim() })
    }
  })

  const logicRules = []
  document.querySelectorAll('#logicList .small-card').forEach(card => {
    const q1 = card.querySelector('.logic-q1')?.value.trim()
    const a1 = card.querySelector('.logic-a1')?.value.trim()
    const q2 = card.querySelector('.logic-q2')?.value.trim()
    const a2 = card.querySelector('.logic-a2')?.value.trim()
    if (q1 && a1 && q2 && a2) {
      logicRules.push({ q1, a1, q2, a2 })
    }
  })

  return {
    fixedDurationToggle: document.getElementById('fixedDurationToggle')?.checked ?? false,
    minDuration: parseFloat(document.getElementById('minDuration')?.value) || 1,
    maxDuration: parseFloat(document.getElementById('maxDuration')?.value) || 30,
    iqrDurationToggle: document.getElementById('iqrDurationToggle')?.checked ?? false,
    iqrK: parseFloat(document.getElementById('iqrKInput')?.value) || confirmedIqrK || 1.5,
    anchors: anchors,
    logicRules: logicRules,
    straightNormalCount: parseInt(document.getElementById('straightNormalCount').value) || 10,
    straightMatrixCount: parseInt(document.getElementById('straightMatrixCount').value) || 15,
    straightNormalPercent: parseInt(document.getElementById('straightNormalPercent').value) || 80,
    straightMatrixPercent: parseInt(document.getElementById('straightMatrixPercent').value) || 90,
    patternMinCycle: parseInt(document.getElementById('patternMinCycle').value) || 3,
    enableDuplicateIP: document.getElementById('enableDuplicateIP').checked,
    enableDuplicateDevice: document.getElementById('enableDuplicateDevice').checked,
    enableDuplicateContact: document.getElementById('enableDuplicateContact').checked
  }
}

// ==================== 各检测规则 ====================

// 题项识别规则：
// 1) 必须以字母开头
// 2) 必须包含至少1个数字（避免把 rid/ip/source 等元数据识别成题项）
// 3) 允许中间下划线分层（如 A3_1）
// 4) 允许多选/开放后缀（如 __1、__1__open）
const QUESTION_COLUMN_REGEX = /^(?=.*\d)[A-Za-z][A-Za-z0-9_]*(?:__(?:\d+|open))*$/

function isQuestionColumnName(columnName) {
  return QUESTION_COLUMN_REGEX.test(String(columnName || '').trim())
}

// 判断是否作答（用于题集合与覆盖率统计）
function isAnsweredValue(val) {
  return val !== undefined && val !== null && val !== ''
}

// 将题号归一到 base 级别：A3_1__2 -> A3_1，D5__1__open -> D5
function toBaseQuestionId(questionId) {
  const s = String(questionId || '').trim()
  return s.split('__')[0]
}

// ==================== 工作量评分（方案A） ====================
// 说明：
// 1) unitSec（单位任务建议时长，秒）当前复用页面配置 secPerQuestion。
//    如需修改默认体验，请在页面中调整“每题最低秒数”，或在这里改造为独立配置。
// 2) 以下是每类题项的指定权重（可直接改常量）：
//    - 普通题（base）：1.0
//    - 多选题项（__数字）：0.2
//    - 开放题（包含__open）：3.0
const WORKLOAD_WEIGHT_BASE = 1.0
const WORKLOAD_WEIGHT_MULTI_OPTION = 0.2
const WORKLOAD_WEIGHT_OPEN = 3.0

function calcWorkloadScore(row, questionCols) {
  let score = 0
  questionCols.forEach(col => {
    if (!isAnsweredValue(row[col])) return

    const parts = String(col || '').trim().split('__')
    const hasOpen = parts.includes('open')
    const hasNumericOption = parts.slice(1).some(p => /^\d+$/.test(p))

    if (hasOpen) {
      score += WORKLOAD_WEIGHT_OPEN
    } else if (hasNumericOption) {
      score += WORKLOAD_WEIGHT_MULTI_OPTION
    } else {
      score += WORKLOAD_WEIGHT_BASE
    }
  })

  return score
}

function calcQuantile(values, q) {
  if (!values || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

function buildIqrCalibrationFromCore(data, questionCols) {
  const coreBaseCount = (detectedCoreBases || []).length
  if (!data || data.length === 0) {
    return { q1: 4, q3: 8, anchorCount: 0, coreBaseCount, source: 'fallback-empty-data' }
  }

  const rows = data.map(row => {
    const durationSec = getDurationSecFromRow(row)
    const workloadScore = calcWorkloadScore(row, questionCols)
    const answeredBaseCount = new Set(
      questionCols.filter(col => isAnsweredValue(row[col])).map(col => toBaseQuestionId(col))
    ).size
    return { durationSec, workloadScore, answeredBaseCount }
  }).filter(r => r.durationSec !== null && r.workloadScore > 0)

  if (rows.length === 0) {
    return { q1: 4, q3: 8, anchorCount: 0, coreBaseCount, source: 'fallback-no-valid-rows' }
  }

  // 以公共题数量作为锚点，取最接近锚点的样本（至少30个，最多总量50%）
  const target = coreBaseCount > 0 ? coreBaseCount : calcMedian(rows.map(r => r.answeredBaseCount)) || 10
  rows.sort((a, b) => Math.abs(a.answeredBaseCount - target) - Math.abs(b.answeredBaseCount - target))
  const anchorTake = Math.max(30, Math.min(Math.floor(rows.length * 0.5), 120))
  const anchorRows = rows.slice(0, Math.min(anchorTake, rows.length))

  const secPerWorkload = anchorRows
    .map(r => r.durationSec / r.workloadScore)
    .filter(v => Number.isFinite(v) && v > 0)

  if (secPerWorkload.length < 10) {
    const allSecPerWorkload = rows
      .map(r => r.durationSec / r.workloadScore)
      .filter(v => Number.isFinite(v) && v > 0)
    const q1All = calcQuantile(allSecPerWorkload, 0.25) ?? 4
    const q3All = calcQuantile(allSecPerWorkload, 0.75) ?? 8
    return {
      q1: q1All,
      q3: Math.max(q3All, q1All + 0.5),
      anchorCount: secPerWorkload.length,
      coreBaseCount,
      source: 'fallback-all-rows'
    }
  }

  const q1 = calcQuantile(secPerWorkload, 0.25) ?? 4
  const q3 = calcQuantile(secPerWorkload, 0.75) ?? 8

  return {
    q1,
    q3: Math.max(q3, q1 + 0.5),
    anchorCount: secPerWorkload.length,
    coreBaseCount,
    source: 'core-anchored-iqr'
  }
}

// 计算中位数（空数组返回 null）
function calcMedian(values) {
  if (!values || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// 计算样本答题时长（秒）
function getDurationSecFromRow(row) {
  const start = excelDateToJSDate(row['start'])
  const finish = excelDateToJSDate(row['finish'])
  if (!start || !finish) return null
  const diffDays = (finish - start) / (1000 * 60 * 60 * 24)
  return diffDays * 24 * 3600
}

// Jaccard 相似度（用于可变题集合并组）
function calcJaccardSimilarity(setA, setB) {
  const union = new Set([...setA, ...setB])
  if (union.size === 0) return 1 // 两者都为空，视为完全一致
  let intersectCount = 0
  setA.forEach(v => {
    if (setB.has(v)) intersectCount++
  })
  return intersectCount / union.size
}

// 基于“核心题 + 可变题相似度”构建路径分组上下文
function buildDurationPathContexts(data, questionCols, options = {}) {
  const coreCoverageThreshold = options.coreCoverageThreshold ?? 0.95
  const jaccardThreshold = options.jaccardThreshold ?? 0.7
  const minGroupSize = options.minGroupSize ?? 20
  const bucketSize = options.bucketSize ?? 10

  // 1) 抽取每个样本的答题集合（raw 与 base）和时长
  const baseCoverageCount = {}
  const records = data.map((row, idx) => {
    const answeredRawCols = questionCols.filter(col => isAnsweredValue(row[col]))
    const answeredRawCount = answeredRawCols.length
    const answeredBaseSet = new Set(answeredRawCols.map(col => toBaseQuestionId(col)))
    answeredBaseSet.forEach(q => {
      baseCoverageCount[q] = (baseCoverageCount[q] || 0) + 1
    })

    return {
      idx,
      durationSec: getDurationSecFromRow(row),
      answeredRawCount,
      answeredBaseSet
    }
  })

  // 2) 自动识别核心题（高覆盖率题）
  const total = data.length || 1
  const coreBaseSet = new Set(
    Object.keys(baseCoverageCount).filter(q => (baseCoverageCount[q] / total) >= coreCoverageThreshold)
  )

  // 3) 计算可变题集合，并按作答题数分桶
  const bucketMap = {}
  records.forEach(rec => {
    const variableSet = new Set([...rec.answeredBaseSet].filter(q => !coreBaseSet.has(q)))
    rec.variableSet = variableSet
    const bucketIndex = Math.floor(rec.answeredRawCount / bucketSize)
    rec.bucketKey = `${bucketIndex * bucketSize}-${bucketIndex * bucketSize + bucketSize - 1}`

    if (!bucketMap[rec.bucketKey]) bucketMap[rec.bucketKey] = []
    bucketMap[rec.bucketKey].push(rec)
  })

  // 全局中位数兜底（秒）
  const globalMedianSec = calcMedian(records.map(r => r.durationSec).filter(v => v !== null)) ?? 600
  const rowContexts = new Array(data.length)

  // 4) 桶内按可变题 Jaccard 相似度并组，组太小时回退到桶级/全局
  Object.values(bucketMap).forEach(bucketRecords => {
    const bucketMedianSec = calcMedian(bucketRecords.map(r => r.durationSec).filter(v => v !== null))
    const bucketEligible = bucketRecords.length >= minGroupSize && bucketMedianSec !== null

    const clusters = []
    bucketRecords.forEach(rec => {
      let bestCluster = null
      let bestScore = -1

      clusters.forEach(cluster => {
        const score = calcJaccardSimilarity(rec.variableSet, cluster.signatureSet)
        if (score > bestScore) {
          bestScore = score
          bestCluster = cluster
        }
      })

      if (!bestCluster || bestScore < jaccardThreshold) {
        clusters.push({
          signatureSet: new Set(rec.variableSet),
          members: [rec]
        })
      } else {
        bestCluster.members.push(rec)
      }
    })

    clusters.forEach(cluster => {
      const clusterMedianSec = calcMedian(cluster.members.map(r => r.durationSec).filter(v => v !== null))
      const clusterEligible = cluster.members.length >= minGroupSize && clusterMedianSec !== null

      cluster.members.forEach(rec => {
        let medianSec = globalMedianSec
        let medianSource = '全局'

        if (clusterEligible) {
          medianSec = clusterMedianSec
          medianSource = '组内'
        } else if (bucketEligible) {
          medianSec = bucketMedianSec
          medianSource = '桶级'
        }

        rowContexts[rec.idx] = {
          durationSec: rec.durationSec,
          answeredCount: rec.answeredRawCount,
          medianSec,
          medianSource
        }
      })
    })
  })

  return { rowContexts, globalMedianSec }
}

function checkDuration(data, config) {
  // valid: 通过时长检测的样本；removed: 被时长规则剔除的样本
  const valid = [], removed = []

  // 提取问卷题目列（如 A3、A3__1）
  const questionCols = rawHeaders.filter(h => isQuestionColumnName(h))

  // 构建路径分组上下文：组内优先，样本不足时回退桶级/全局
  const { rowContexts, globalMedianSec } = buildDurationPathContexts(data, questionCols, {
    coreCoverageThreshold: 0.95,
    jaccardThreshold: 0.7,
    minGroupSize: 20,
    bucketSize: 10
  })

  // 如果开启了 IQR 校准规则，则准备校准参数
  let iqrCal = null, iqrK = 1.5, iqr = 0, minSecPerWorkload = 0, maxSecPerWorkload = 0
  if (config.iqrDurationToggle) {
    iqrCal = iqrCalibrationResult || buildIqrCalibrationFromCore(data, questionCols)
    iqrK = config.iqrK ?? confirmedIqrK ?? 1.5
    iqr = iqrCal.q3 - iqrCal.q1
    minSecPerWorkload = Math.max(iqrCal.q1 - iqrK * iqr, 0.5)
    maxSecPerWorkload = iqrCal.q3 + iqrK * iqr

    addLog(
      `时长IQR校准启用: 来源=${iqrCal.source}, 公共题base=${iqrCal.coreBaseCount}, 锚定样本=${iqrCal.anchorCount}, Q1=${iqrCal.q1.toFixed(2)}秒/工作量, Q3=${iqrCal.q3.toFixed(2)}秒/工作量, IQR=${iqr.toFixed(2)}, k=${iqrK}, 合理范围=${minSecPerWorkload.toFixed(2)}~${maxSecPerWorkload.toFixed(2)}秒/工作量`
    )
  }

  // 对每个样本执行时长判定：任一启用规则命中即剔除
  data.forEach((row, idx) => {
    const ctx = rowContexts[idx] || { durationSec: null, answeredCount: 0, medianSec: globalMedianSec, medianSource: '全局' }

    // 统一计算工作量信息（用于详情展示）
    const workloadScore = calcWorkloadScore(row, questionCols)
    const answeredBaseSet = new Set(
      questionCols.filter(col => isAnsweredValue(row[col])).map(col => toBaseQuestionId(col))
    )
    const answeredBaseCount = answeredBaseSet.size
    const answeredRawCount = questionCols.filter(col => isAnsweredValue(row[col])).length

    // start/finish 缺失无法计算时长，直接按"答题时长"规则剔除
    if (ctx.durationSec === null) {
      removed.push({
        ...row,
        _removeReason: '缺失答题时间',
        _removeRule: '答题时长',
        _removeDetail: `start/finish为空 | 作答${answeredBaseCount}道base题(${answeredRawCount}个选项)，工作量${workloadScore.toFixed(1)}`
      })
      return
    }

    // 当前样本实际答题时长（秒）
    const durationSec = ctx.durationSec
    let reasons = []

    // 规则1：固定时长区间（页面输入是分钟，比较前换算成秒）
    if (config.fixedDurationToggle) {
      const minSec = config.minDuration * 60
      const maxSec = config.maxDuration * 60
      if (durationSec < minSec) reasons.push(`低于最小值${config.minDuration}分钟`)
      if (durationSec > maxSec) reasons.push(`高于最大值${config.maxDuration}分钟`)
    }

    // 规则2：工作量IQR区间（方案A + Tukey离群值检测）
    if (config.iqrDurationToggle && iqrCal) {
      const minSecIQR = workloadScore * minSecPerWorkload
      const maxSecIQR = workloadScore * maxSecPerWorkload
      if (durationSec < minSecIQR || durationSec > maxSecIQR) {
        reasons.push(
          `超出IQR区间(k=${iqrK}, W=${workloadScore.toFixed(2)}, 应在${minSecIQR.toFixed(1)}~${maxSecIQR.toFixed(1)}秒)`
        )
      }
    }

    // reasons 非空：命中至少一条时长规则，进入 removed；否则保留到 valid
    if (reasons.length > 0) {
      removed.push({
        ...row,
        _removeReason: '答题时长异常',
        _removeRule: '答题时长',
        _removeDetail: `实际${durationSec.toFixed(0)}秒，作答${answeredBaseCount}道base题(${answeredRawCount}个选项)，工作量${workloadScore.toFixed(1)}，${reasons.join('、')}`
      })
    } else {
      valid.push(row)
    }
  })

  return { valid, removed }
}

function checkAnchorQuestions(data, config) {
  const valid = [], removed = []
  data.forEach(row => {
    let failed = null
    for (const anchor of config.anchors) {
      const answer = row[anchor.question]
      if (answer !== undefined && String(answer) !== String(anchor.answer)) {
        failed = anchor
        break
      }
    }
    if (failed) {
      removed.push({ ...row, _removeReason: '锚定题未通过', _removeRule: '锚定题', _removeDetail: `${failed.question}: "${row[failed.question]}"≠"${failed.answer}"` })
    } else {
      valid.push(row)
    }
  })
  return { valid, removed }
}

function checkStraightAnswers(data, config) {
  const valid = [], marked = []

  // 分组题目：矩阵题 vs 独立题
  const matrixGroups = {}  // { 'A3': ['A3__1', 'A3__2', ...], 'B1': [...] }
  const normalQuestions = []  // ['A4', 'A5', ...]

  const questionCols = rawHeaders.filter(h => isQuestionColumnName(h))

  questionCols.forEach(col => {
    const match = col.match(/^([A-Za-z]\d+)(?:__(\d+))?$/)
    if (match) {
      const baseName = match[1]  // A3
      const subNum = match[2]    // 1 or undefined

      if (subNum) {
        // 矩阵题
        if (!matrixGroups[baseName]) matrixGroups[baseName] = []
        matrixGroups[baseName].push(col)
      } else {
        // 独立题
        normalQuestions.push(col)
      }
    }
  })

  data.forEach(row => {
    let hasStraight = false
    let straightDetail = []

    // 检测独立题
    if (normalQuestions.length > 0) {
      const normalAnswers = normalQuestions.map(col => row[col]).filter(v => v !== undefined && v !== '' && v !== null)
      const result = detectStraightPattern(normalAnswers, config.straightNormalCount, config.straightNormalPercent)
      if (result.isStraight) {
        hasStraight = true
        straightDetail.push(`独立题连续${result.maxStreak}题，同选项${result.samePercent.toFixed(0)}%`)
      }
    }

    // 检测矩阵题（每个矩阵单独检测）
    for (const [baseName, cols] of Object.entries(matrixGroups)) {
      const matrixAnswers = cols.map(col => row[col]).filter(v => v !== undefined && v !== '' && v !== null)
      const result = detectStraightPattern(matrixAnswers, config.straightMatrixCount, config.straightMatrixPercent)
      if (result.isStraight) {
        hasStraight = true
        straightDetail.push(`${baseName}矩阵连续${result.maxStreak}题，同选项${result.samePercent.toFixed(0)}%`)
      }
    }

    if (hasStraight) {
      marked.push({ ...row, _markReason: '直线作答嫌疑', _markRule: '直线作答', _markDetail: straightDetail.join('；') })
    } else {
      valid.push(row)
    }
  })

  return { valid, marked }
}

// 辅助函数：检测直线作答模式
function detectStraightPattern(answers, threshold, percentThreshold) {
  if (answers.length === 0) return { isStraight: false, maxStreak: 0, samePercent: 0 }

  let maxStreak = 1, currentStreak = 1, streakValue = answers[0]

  for (let i = 1; i < answers.length; i++) {
    if (String(answers[i]) === String(streakValue)) {
      currentStreak++
      maxStreak = Math.max(maxStreak, currentStreak)
    } else {
      currentStreak = 1
      streakValue = answers[i]
    }
  }

  const uniqueAnswers = [...new Set(answers.map(String))]
  const maxSameCount = Math.max(...uniqueAnswers.map(u => answers.filter(a => String(a) === u).length))
  const samePercent = answers.length > 0 ? (maxSameCount / answers.length) * 100 : 0

  return {
    isStraight: maxStreak >= threshold && samePercent >= percentThreshold,
    maxStreak,
    samePercent
  }
}

function checkPatternAnswers(data, config) {
  const valid = [], removed = []
  const questionCols = rawHeaders.filter(h => isQuestionColumnName(h))

  data.forEach(row => {
    const answers = questionCols.map(col => row[col]).filter(v => v !== undefined && v !== '' && v !== null)
    let hasPattern = false, patternType = ''

    // 检测周期2模式 (ABAB)
    if (answers.length >= config.patternMinCycle * 2) {
      let cycle2 = true
      for (let i = 2; i < answers.length; i++) {
        if (String(answers[i]) !== String(answers[i % 2])) { cycle2 = false; break }
      }
      if (cycle2) { hasPattern = true; patternType = 'ABAB交替模式' }
    }

    // 检测周期3模式 (ABCABC)
    if (!hasPattern && answers.length >= config.patternMinCycle * 2) {
      let cycle3 = true
      for (let i = 3; i < answers.length; i++) {
        if (String(answers[i]) !== String(answers[i % 3])) { cycle3 = false; break }
      }
      if (cycle3) { hasPattern = true; patternType = 'ABCABC循环模式' }
    }

    if (hasPattern) {
      removed.push({ ...row, _removeReason: '规律作答', _removeRule: '规律作答', _removeDetail: patternType })
    } else {
      valid.push(row)
    }
  })
  return { valid, removed }
}

function checkLogicConflict(data, config) {
  const valid = [], removed = []

  data.forEach(row => {
    let hasConflict = false
    let conflictDetail = []

    for (const rule of config.logicRules) {
      const ans1 = String(row[rule.q1] ?? '')
      const ans2 = String(row[rule.q2] ?? '')

      // 如果两题都有答案，且同时满足矛盾条件
      if (ans1 && ans2 && ans1 === rule.a1 && ans2 === rule.a2) {
        hasConflict = true
        conflictDetail.push(`${rule.q1}=${rule.a1} 且 ${rule.q2}=${rule.a2}`)
      }
    }

    if (hasConflict) {
      removed.push({ ...row, _removeReason: '逻辑矛盾', _removeRule: '逻辑矛盾', _removeDetail: conflictDetail.join('；') })
    } else {
      valid.push(row)
    }
  })

  return { valid, removed }
}

function checkDuplicateIP(data) {
  const valid = [], removed = []
  const ipCount = {}
  data.forEach(row => {
    const ip = row['ip'] || row['IP']
    if (ip) ipCount[ip] = (ipCount[ip] || 0) + 1
  })
  const duplicateIPs = Object.keys(ipCount).filter(ip => ipCount[ip] >= 2)

  data.forEach(row => {
    const ip = row['ip'] || row['IP']
    if (ip && duplicateIPs.includes(ip)) {
      removed.push({ ...row, _removeReason: 'IP重复', _removeRule: 'IP重复', _removeDetail: `${ip} 出现${ipCount[ip]}次` })
    } else {
      valid.push(row)
    }
  })
  return { valid, removed }
}

function checkDuplicateDevice(data) {
  const valid = [], removed = []
  const deviceCount = {}
  data.forEach(row => {
    const device = row['devicenumber'] || row['device'] || row['device_id'] || row['deviceid']
    if (device) deviceCount[device] = (deviceCount[device] || 0) + 1
  })
  const duplicateDevices = Object.keys(deviceCount).filter(d => deviceCount[d] >= 2)

  data.forEach(row => {
    const device = row['devicenumber'] || row['device'] || row['device_id'] || row['deviceid']
    if (device && duplicateDevices.includes(device)) {
      removed.push({ ...row, _removeReason: '设备重复', _removeRule: '设备重复', _removeDetail: `${device} 出现${deviceCount[device]}次` })
    } else {
      valid.push(row)
    }
  })
  return { valid, removed }
}

function checkDuplicateContact(data) {
  const valid = [], removed = []
  const phoneCount = {}, emailCount = {}
  data.forEach(row => {
    const phone = row['phone'] || row['mobile'] || row['tel'] || row['phonenumber']
    const email = row['email'] || row['mail']
    if (phone) phoneCount[phone] = (phoneCount[phone] || 0) + 1
    if (email) emailCount[email] = (emailCount[email] || 0) + 1
  })
  const duplicatePhones = Object.keys(phoneCount).filter(p => phoneCount[p] >= 2)
  const duplicateEmails = Object.keys(emailCount).filter(e => emailCount[e] >= 2)

  data.forEach(row => {
    const phone = row['phone'] || row['mobile'] || row['tel'] || row['phonenumber']
    const email = row['email'] || row['mail']
    if (phone && duplicatePhones.includes(phone)) {
      removed.push({ ...row, _removeReason: '手机号重复', _removeRule: '联系方式重复', _removeDetail: phone })
    } else if (email && duplicateEmails.includes(email)) {
      removed.push({ ...row, _removeReason: '邮箱重复', _removeRule: '联系方式重复', _removeDetail: email })
    } else {
      valid.push(row)
    }
  })
  return { valid, removed }
}

// ==================== 结果显示 ====================
function renderRuleStats(total) {
  const statsHtml = Object.entries(ruleStats)
    .filter(([_, count]) => count > 0)
    .map(([rule, count]) => {
      const percent = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
      return `
        <div class="bg-white border border-[#ECE4DA] rounded-2xl px-4 py-4">
          <div class="flex justify-between text-sm mb-2">
            <span class="text-[#6B6B6B]">${rule}</span>
            <span class="font-bold">${count}人 (${percent}%)</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${percent}%"></div>
          </div>
        </div>
      `
    }).join('')

  document.getElementById('ruleStats').innerHTML = statsHtml || `
    <div class="bg-white border border-[#ECE4DA] rounded-2xl px-4 py-4 text-[#8F877C]">
      暂无统计数据
    </div>
  `
}

function renderRemovedTable() {
  const tbody = document.getElementById('removedTable')
  if (removedData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-10 text-center text-[#A49B91]">
          暂无剔除数据
        </td>
      </tr>
    `
    return
  }

  tbody.innerHTML = removedData.map((row, idx) => `
    <tr class="border-b border-[#EEE7DE]">
      <td class="py-3">${idx + 1}</td>
      <td class="py-3">${row['rid'] || row['RID'] || row['_rowIndex'] || '-'}</td>
      <td class="py-3">${row._removeReason}</td>
      <td class="py-3"><span class="badge badge-red">${row._removeRule}</span></td>
      <td class="py-3 text-xs text-[#8F877C]">${row._removeDetail}</td>
    </tr>
  `).join('')
}

function renderMarkedTable() {
  const tbody = document.getElementById('markedTable')
  if (markedData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-10 text-center text-[#A49B91]">
          暂无标记数据
        </td>
      </tr>
    `
    return
  }

  tbody.innerHTML = markedData.map((row, idx) => `
    <tr class="border-b border-[#EEE7DE]">
      <td class="py-3">${idx + 1}</td>
      <td class="py-3">${row['rid'] || row['RID'] || row['_rowIndex'] || '-'}</td>
      <td class="py-3">${row._markReason}</td>
      <td class="py-3"><span class="badge badge-yellow">${row._markRule}</span></td>
      <td class="py-3 text-xs text-[#8F877C]">${row._markDetail}</td>
    </tr>
  `).join('')
}

// ==================== 导出功能 ====================
function downloadCleanData() {
  if (!cleanData || cleanData.length === 0) {
    showToast('暂无清洗数据可导出')
    return
  }

  // 准备数据行
  const dataRows = cleanData.map(row => {
    const obj = {}
    rawHeaders.forEach(h => obj[h] = row[h])
    // 添加标记信息
    const marked = markedData.find(m => m._rowIndex === row._rowIndex)
    if (marked) {
      obj['_复核标记'] = marked._markReason
      obj['_标记详情'] = marked._markDetail
    }
    return obj
  })

  // 如果有双表头，构建带双表头的数据
  let exportData = dataRows
  if (rawHeaderRows.length === 2) {
    // 构建双表头行
    const headerRow1 = {}
    const headerRow2 = {}
    rawHeaders.forEach((h, i) => {
      headerRow1[h] = rawHeaderRows[0][i] || ''
      headerRow2[h] = rawHeaderRows[1][i] || ''
    })
    // 标记列的表头
    headerRow1['_复核标记'] = ''
    headerRow1['_标记详情'] = ''
    headerRow2['_复核标记'] = '_复核标记'
    headerRow2['_标记详情'] = '_标记详情'
    exportData = [headerRow1, headerRow2, ...dataRows]
  }

  const ws = XLSX.utils.json_to_sheet(exportData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '清洗后数据')
  XLSX.writeFile(wb, '清洗后数据.xlsx')
  showToast('清洗数据已导出')
  addLog('下载清洗后数据')
}

function downloadRemovedData() {
  if (removedData.length === 0) {
    showToast('暂无剔除数据可导出')
    return
  }

  // 准备数据行
  const dataRows = removedData.map(row => {
    const obj = {}
    rawHeaders.forEach(h => obj[h] = row[h])
    obj['_剔除原因'] = row._removeReason
    obj['_剔除规则'] = row._removeRule
    obj['_剔除详情'] = row._removeDetail
    return obj
  })

  // 如果有双表头，构建带双表头的数据
  let exportData = dataRows
  if (rawHeaderRows.length === 2) {
    // 构建双表头行
    const headerRow1 = {}
    const headerRow2 = {}
    rawHeaders.forEach((h, i) => {
      headerRow1[h] = rawHeaderRows[0][i] || ''
      headerRow2[h] = rawHeaderRows[1][i] || ''
    })
    // 剔除信息列的表头
    headerRow1['_剔除原因'] = ''
    headerRow1['_剔除规则'] = ''
    headerRow1['_剔除详情'] = ''
    headerRow2['_剔除原因'] = '_剔除原因'
    headerRow2['_剔除规则'] = '_剔除规则'
    headerRow2['_剔除详情'] = '_剔除详情'
    exportData = [headerRow1, headerRow2, ...dataRows]
  }

  const ws = XLSX.utils.json_to_sheet(exportData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '剔除明细')
  XLSX.writeFile(wb, '剔除明细.xlsx')
  showToast('剔除明细已导出')
  addLog('下载剔除明细')
}

function downloadReport() {
  const total = parseInt(document.getElementById('totalCount').innerText)
  const valid = parseInt(document.getElementById('validCount').innerText)
  const removed = parseInt(document.getElementById('removedCount').innerText)

  if (total === 0) {
    showToast('暂无数据可导出')
    return
  }

  const report = {
    '清洗时间': new Date().toLocaleString(),
    '原始样本数': total,
    '有效样本数': valid,
    '剔除样本数': removed,
    '标记复核数': markedData.length,
    '有效率': total > 0 ? ((valid / total) * 100).toFixed(2) + '%' : '0%',
    ...ruleStats
  }

  const ws = XLSX.utils.json_to_sheet([report])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '清洗报告')
  XLSX.writeFile(wb, '清洗报告.xlsx')
  showToast('清洗报告已导出')
  addLog('下载清洗报告')
}
