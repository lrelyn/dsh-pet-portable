// preload 桥：只暴露窗口控制原语——
//   - setBounds：宠物窗口逐帧跟随（renderer 上报包围盒的屏幕坐标，主进程 setContentBounds）。
//     x/y/width/height = 窗口内容区坐标（用于移动窗口）；boxX/boxY = 宠物包围盒左上角
//     （工作区坐标）——碰撞站场必须用包围盒坐标，不能用窗口坐标（窗口 = 包围盒 + 四周外扩 margin，
//     差半只宠物宽，会让跨窗碰撞检测整体错位）。
//     size/bottomPad = 碰撞站场登记用（静止宠物只发 set-bounds，靠它带上尺寸才能被其它
//     飞行宠物撞到）；vx/vy = 当前速度（飞行中实时值，静止/拖拽 = 0）。
//   - setInteractive：点击穿透翻转——窗口默认整窗穿透（透明像素不挡下层应用），
//     renderer 在光标进/出宠物身体命中区时上报，主进程 setIgnoreMouseEvents 翻转。
//   - setInputBusy：**我正在用这个窗口的鼠标输入**（拖拽中 / 菜单开着 / 对话弹窗开着），
//     由渲染端上报。主进程光看光标位置与窗口位移分不清"拖拽跟手"和"漫游/抛掷"，而渲染端知道。
//     busy 期间主进程的兜底通道**绝不翻回穿透**（一旦翻回，渲染端正在用的 window 级
//     pointermove/pointerup 就断了：宠物会按旧速度飞出去，连松手的 pointerup 都收不到）。
//     只在状态翻转时发一次（幂等，不逐帧）。
//   - 宠物间碰撞（跨窗，主进程 broker）：
//       reportFlight：飞行中每 ~30ms 上报自己的状态（位置/速度/尺寸）→ 主进程汇聚并广播；
//       onFlightStates：订阅主进程广播的全量宠物状态（碰撞检测用其它宠物的最新位置/速度）；
//       reportCollide：本窗飞行方检测到撞到 targetId → 主进程把动量结果转发给目标窗；
//       onPetHit：订阅「你被撞了」→ 用新初速 startThrow 抛出去（与浏览器 onHit 同语义）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  setBounds(x, y, width, height, boxX, boxY, size, bottomPad, vx, vy) {
    ipcRenderer.send('pet:set-bounds', { x, y, width, height, boxX, boxY, size, bottomPad, vx, vy });
  },
  setInteractive(interactive) {
    ipcRenderer.send('pet:set-interactive', !!interactive);
  },
  // 我正在用这个窗口的鼠标输入（拖拽中/菜单开/弹窗开）：主进程兜底通道在 busy 期间绝不翻回穿透
  setInputBusy(busy) {
    ipcRenderer.send('pet:input-busy', !!busy);
  },
  // 右键菜单「打开网站」：主进程用系统默认浏览器打开 DSH 网站（等效网页 Ctrl+点击链接）
  // 注意：独立打包版的菜单已把这一项换成「使用说明」（见 sprite.js），本通道当前无调用方；
  // 保留是因为 DSH 宿主模式下的菜单树由 src/shared/menu.ts 生成，可能仍有入口。
  openDshSite(url) {
    ipcRenderer.send('pet:open-site', { url });
  },
  // 打开桌宠文件夹里的本地文件：主进程用系统默认程序打开（.txt → 记事本，.jpg → 图片查看器）。
  // rel = 相对包根的文件名，主进程负责收口与存在性校验。
  // 注：菜单里的「使用说明」已改为网页版（走下面的 openHelpPage），本通道当前无调用方；
  // 保留作为通用能力，将来要开包内其它文件可以直接用。
  openLocalFile(rel) {
    ipcRenderer.send('pet:open-local-file', { rel });
  },
  // 右键菜单「使用说明」（网页版）：主进程拼好包内 使用说明.html 的 file:// 地址，
  // 用系统默认浏览器打开。路径由主进程算——渲染端不知道包根在哪。
  openHelpPage() {
    ipcRenderer.send('pet:open-help', {});
  },
  // ---- 宠物间碰撞（跨窗 broker）----
  reportFlight(state) {
    ipcRenderer.send('pet:report-flight', state);
  },
  onFlightStates(cb) {
    ipcRenderer.on('pet:flight-states', (e, states) => cb(states));
  },
  reportCollide(targetId, vx, vy) {
    ipcRenderer.send('pet:collide-result', { targetId, vx, vy });
  },
  onPetHit(cb) {
    ipcRenderer.on('pet:hit', (e, payload) => cb(payload));
  },
  // 显示器热更新：分辨率/缩放变化、插拔屏、旋转后主进程重算桌面几何并推来
  // （{hull, areas, primaryIndex}，屏幕坐标）——渲染端就地重挂视口与边界。
  onDisplays(cb) {
    ipcRenderer.on('pet:displays', (e, geo) => cb(geo));
  },
  // ---- 设置菜单里的两项维护操作 ----
  // 开机自启动：写 HKCU 的 Run 键（不需要管理员权限）。用 invoke 取回结果，
  // 菜单才能把"成功/失败"如实回报，而不是假装成功。
  setAutoStart(enabled) {
    return ipcRenderer.invoke('pet:set-autostart', !!enabled);
  },
  getAutoStart() {
    return ipcRenderer.invoke('pet:get-autostart');
  },
  // ---- 心情持久化（P1-4）----
  // 渲染进程没有文件系统权限（contextIsolation），所以走主进程读写
  // data/memory.json。用 invoke 是为了让调用方能 await 到结果。
  // 只存 { mood, updatedAt }，与宿主的对话记忆同文件但不同键，互不干扰。
  loadMood() {
    return ipcRenderer.invoke('pet:load-mood');
  },
  saveMood(mood) {
    return ipcRenderer.invoke('pet:save-mood', { mood });
  },
  // ---- 前台窗口采样（独立版 workStatus 触发源）----
  // 渲染进程拿不到 child_process，采样在主进程做（一个进程服务所有宠物窗口），
  // 这里只负责「请求开始/停止」和「订阅采样结果」。状态机仍在各自 renderer 里跑
  // —— 多开时每只宠物的检测参数可能不同，不能共享状态。
  startForegroundWatch(intervalSec) {
    return ipcRenderer.invoke('pet:foreground-start', { intervalSec });
  },
  stopForegroundWatch() {
    ipcRenderer.send('pet:foreground-stop');
  },
  onForeground(cb) {
    ipcRenderer.on('pet:foreground', (e, info) => cb(info));
  },
  // ---- 完整状态快照（心情/精力/饱食/好感度 + 存档时间）----
  // 与 memory.json 分开：memory 装宿主的对话记忆，这里装会演化的数值。
  // 每只宠物一个文件，多开时各自的精力/饱食独立。
  loadState(petId) {
    return ipcRenderer.invoke('pet:load-state', { petId });
  },
  saveState(petId, state) {
    return ipcRenderer.invoke('pet:save-state', { petId, state });
  },
  /** 诊断：把消息写进 pet.log（渲染进程 console 不进文件，排查用） */
  diag(msg) {
    ipcRenderer.send('pet:diag', msg);
  },
  // 退出桌宠：关掉宿主(node)与宠物窗口，主进程随后自行退出。
  quitPet() {
    ipcRenderer.send('pet:quit');
  },
});
