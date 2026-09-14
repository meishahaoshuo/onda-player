<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import SongContextMenu from '@/components/SongContextMenu.vue'
import SongsView from '@/views/SongsView.vue'
import FoldersView from '@/views/FoldersView.vue'
import AlbumsView from '@/views/AlbumsView.vue'
import AlbumDetailView from '@/views/AlbumDetailView.vue'
import ArtistDetailView from '@/views/ArtistDetailView.vue'
import ArtistsView from '@/views/ArtistsView.vue'
import FavoritesView from '@/views/FavoritesView.vue'
import ChartsView from '@/views/ChartsView.vue'
import RecentView from '@/views/RecentView.vue'
import SearchResultsView from '@/views/SearchResultsView.vue'
import AppIcon from '@/components/AppIcon.vue'
import PlaylistsView from '@/views/PlaylistsView.vue'
import LyricsFullView from '@/views/LyricsFullView.vue'
import SettingsView from '@/views/SettingsView.vue'
import PlaceholderView from '@/views/PlaceholderView.vue'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { usePlaylistStore } from '@/stores/playlist'
import { useStatsStore } from '@/stores/stats'
import { useFavoritesStore } from '@/stores/favorites'
import { useSettingsStore } from '@/stores/settings'
import { clearTransitionState } from '@/services/pageTransition'
import { useSearchScope } from '@/composables/useSearchScope'
import { installTrackSwapWatcher } from '@/services/coverFlight'
import { installHotkeys } from '@/services/hotkeys'
import { installAbsorbFlight } from '@/services/absorbFlight'
import { extractBrightColors } from '@/services/palette'
import { initDesktop, isDesktop } from '@/services/desktop'
import TitleBar from '@/components/TitleBar.vue'
import type { ViewId } from '@/types'

const ui = useUiStore()
const library = useLibraryStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const stats = useStatsStore()
const favorites = useFavoritesStore()
const settings = useSettingsStore()

const viewTitles: Record<ViewId, string> = {
  songs: '歌曲',
  favorites: '我喜欢的音乐',
  recent: '最近在听',
  charts: '排行榜',
  albums: '专辑',
  artists: '艺术家',
  folders: '文件夹',
  playlists: '歌单',
  settings: '设置',
}

const title = computed(() => viewTitles[ui.activeView])
const sectionEl = ref<HTMLElement | null>(null)

/**
 * 底部安全空间：两种播放条形态（标准/胶囊）都是悬浮于内容上方的液态玻璃条
 * （标准条 absolute 贴底、胶囊 fixed 居中），滚动内容都会从玻璃后面穿过，
 * 因此 view-body 与详情覆盖层一律预留 96px 底部 padding，不再按形态区分。
 */

/** 是否有搜索关键词（内容区被搜索结果接管） */
const searching = computed(() => ui.searchQuery.trim().length > 0)

/**
 * 能否返回上一级：任一「推入式详情」打开（专辑 / 艺术家 / 歌单）。
 * 顶栏返回钮是**常驻**的（用户要求：位置恒定，不要忽隐忽现），
 * 没有上一级时保留按钮但置灰，而不是整个隐藏。
 */
const canGoBack = computed(
  () =>
    !!ui.detailKey &&
    (ui.activeView === 'albums' || ui.activeView === 'artists' || ui.activeView === 'playlists'),
)

/**
 * 顶栏返回：详情关闭要跑「引力坍缩」的反向过渡（playAlbumExit + beginDollyExit），
 * 那套收尾只有详情组件自己知道怎么走，故这里只派发事件、由详情接住调用它自己的 close()。
 * 与托盘播放控制（`onda:tray-*` → App.vue）用的是同一套解耦方式。
 */
function backFromDetail() {
  if (!canGoBack.value) return
  window.dispatchEvent(new CustomEvent('onda:detail-back'))
}
const { scope: searchScope } = useSearchScope()
const searchPlaceholder = computed(() =>
  searchScope.value.scoped
    ? `在「${searchScope.value.label}」中搜索`
    : '搜索歌曲、艺术家、专辑',
)

/* ---------- 全应用滚动位置记忆 ----------
   切视图 / 钻取详情前把旧容器的 scrollTop 记入 ui store，
   回来时（Transition enter 或同视图钻取返回）恢复。
   key：`view:<视图>|<detailKey>`；各 .scroll-host 内列表的滚动由
   SongList/VirtualList 以 list:* 键自存自取（外层滚动架构下记录的就是宿主 scrollTop）。 */
const scrollKey = (view: string, detail: string | null) => `view:${view}|${detail ?? ''}`
// 歌单详情已改为覆盖层（网格常驻），不再使用外层滚动记忆
const INLINE_DETAIL_VIEWS = new Set<string>([])

watch(
  [() => ui.activeView, () => ui.detailKey] as const,
  ([view, detail], [oldView, oldDetail]) => {
    // pre-flush：此刻 DOM 还是旧视图的，正好捕获它的滚动位置
    if (sectionEl.value) {
      ui.rememberScroll(scrollKey(oldView, oldDetail), sectionEl.value.scrollTop)
    }
    // 同视图内钻取/返回（详情内联在视图里，DOM 会重建）：更新后恢复目标状态的位置。
    // 专辑详情是覆盖层、网格 DOM 不重建，绝不能在这里动它的 scrollTop。
    if (view === oldView && detail !== oldDetail && INLINE_DETAIL_VIEWS.has(view)) {
      nextTick(() => {
        if (sectionEl.value) sectionEl.value.scrollTop = ui.recallScroll(scrollKey(view, detail))
      })
    }
  },
)

function onViewEnter(el: Element) {
  ;(el as HTMLElement).scrollTop = ui.recallScroll(scrollKey(ui.activeView, ui.detailKey))
}

function addFolder() {
  library.addFolder()
}

onMounted(async () => {
  settings // 触发主题初始化
  playlistStore.load()
  void stats.load()
  void favorites.load()
  // 遗留清理：自定义壁纸功能已移除，清掉旧版本可能残留在 IndexedDB kv 里的壁纸数据
  void import('@/services/db')
    .then((db) => Promise.all([db.kvSet('wallpaper', null), db.kvSet('wallpaper-blur', null)]))
    .catch(() => {})
  await library.init()
  await player.restore()
  installTrackSwapWatcher()
  installAbsorbFlight()
  installHotkeys()
  // 桌面端（Tauri）：磨砂窗口、窗口状态记忆、托盘播放控制（浏览器形态零开销）
  if (isDesktop) {
    void initDesktop()
    window.addEventListener('onda:tray-playpause', () => player.togglePlay())
    window.addEventListener('onda:tray-prev', () => player.prev())
    window.addEventListener('onda:tray-next', () => player.next())
  }
})

/** 切换视图时清理过渡残留（网格可能已被卸载，动画引用会指向已销毁的 DOM） */
watch(
  () => ui.activeView,
  () => clearTransitionState(),
)

/* ---------- 封面氛围光：取当前播放封面主色的两个低强度光斑 ---------- */
const ambientColors = ref<(string | null)[]>([])
let ambientSeq = 0

watch(
  () => player.current?.coverId ?? null,
  async (coverId) => {
    if (!coverId) {
      ambientColors.value = []
      return
    }
    const seq = ++ambientSeq
    try {
      const url = await library.coverUrl(coverId)
      if (!url || seq !== ambientSeq) return
      const blob = await (await fetch(url)).blob()
      const colors = await extractBrightColors(blob).catch(() => [] as string[])
      if (seq !== ambientSeq) return
      ambientColors.value = colors.length > 0 ? colors.slice(0, 2) : [null, null]
    } catch {
      /* 取色失败保持无氛围光 */
    }
  },
  { immediate: true },
)

/** 详情覆盖层被绕过返回过渡直接关闭时（典型：详情打开时点侧边栏当前视图，
    navigate 只改 detailKey、activeView 不变，上面那个 watcher 不会触发），
    必须强制清理 —— 否则网格卡片停留在坍缩终态（opacity:0），表现为大面积空白。 */
watch(
  () => ui.detailKey,
  (detail, old) => {
    if (detail === null && old !== null) clearTransitionState()
  },
)
</script>

<template>
  <div class="app-shell">
    <!-- 窗口控制钮：歌词全屏页打开时整体隐藏。
         .lyrics-full 是 z-index 50 的整屏覆盖层，而 .titlebar 是 z-index 60 的固定定位，
         三枚窗口按钮会压在歌词页自己的「设置 / 退出」按钮（top:18 right:22）正上方把它们吃掉点击。
         歌词页自己的工具组才是该界面的正确出口，故此处让位。 -->
    <TitleBar v-if="isDesktop && !ui.lyricsOpen" />
        <div class="body-row">
      <Sidebar />
      <main class="content">
        <!-- 封面氛围光：跟随当前播放封面取色的低强度背景光斑（默认常开） -->
        <div v-if="player.current?.coverId" class="ambient-layer" aria-hidden="true">
          <Transition v-for="(c, i) in ambientColors" :key="`${player.currentPath}-${i}`" name="ambient">
            <div v-if="c" class="ambient-blob" :class="`ab-${i}`" :style="{ '--fc': c }" />
          </Transition>
        </div>
        <header class="view-header" data-tauri-drag-region>
          <h1>{{ title }}</h1>
          <!-- 返回：常驻在搜索框左侧，位置恒定（不随详情开关忽隐忽现）。
               没有上一级时置灰 —— 桌面端惯例是「返回在左、窗口控制在右」，
               放这里既不与窗口按钮抢位，也不会被误当成关闭窗口（× 才是关闭） -->
          <button
            class="head-back"
            :disabled="!canGoBack"
            :title="canGoBack ? '返回上一级' : '已在最上层'"
            aria-label="返回上一级"
            @click="backFromDetail"
          >
            <AppIcon name="back" :size="17" />
          </button>
          <div class="search-box">
            <AppIcon name="search" :size="15" />
            <input
              v-model="ui.searchQuery"
              class="search-input"
              type="text"
              :placeholder="searchPlaceholder"
              @keydown.esc="ui.searchQuery = ''"
            />
            <button v-if="ui.searchQuery" class="search-clear" title="清除搜索" @click="ui.searchQuery = ''">
              <AppIcon name="close" :size="12" />
            </button>
          </div>
        </header>
        <Transition name="view" mode="out-in" @enter="onViewEnter">
          <section
            ref="sectionEl"
            :key="ui.activeView"
            class="view-body scroll-host"
            :class="{ 'stable-gutter': ui.activeView === 'settings' }"
          >
            <!-- 搜索优先：有关键词时内容区显示搜索结果 -->
            <!-- 注意：这条 v-if / v-else-if 链必须从 SongsView 一路连通到 PlaceholderView。
                 曾经 template v-if 与 SongsView 的 v-if 断开成两条链，
                 songs 视图下兜底的 PlaceholderView 也会渲染，view-body 被撑出
                 双倍高度 → 外层滚动条出现 + 内层虚拟列表失效。 -->
            <SearchResultsView v-if="ui.searchQuery.trim()" />

            <SongsView v-else-if="ui.activeView === 'songs'" />

            <FavoritesView v-else-if="ui.activeView === 'favorites'" />

            <RecentView v-else-if="ui.activeView === 'recent'" />

            <ChartsView v-else-if="ui.activeView === 'charts'" />

            <AlbumsView v-else-if="ui.activeView === 'albums'" />

            <ArtistsView v-else-if="ui.activeView === 'artists'" />

            <FoldersView v-else-if="ui.activeView === 'folders'" v-model:selected-root="ui.folderRootId" @add-folder="addFolder" />

            <PlaylistsView v-else-if="ui.activeView === 'playlists'" />

            <SettingsView v-else-if="ui.activeView === 'settings'" @add-folder="addFolder" />

            <PlaceholderView v-else :key="ui.activeView" :title="title" />
          </section>
        </Transition>

        <!-- 专辑详情：不放在上面的 Transition 里。
             详情与网格是同 activeView 内的 detailKey 切换，:key 不变 → 外层 Transition 不会触发；
             而 v-if/v-else 会让网格立刻卸载，网格就没法参与"相机后退"。
             移到 .content 内的绝对定位覆盖层后，网格始终挂载，滚动位置与卡片 DOM 全部保留。 -->
        <!-- 详情层裁切容器：详情层的「引力坍缩」会把整层 translate 到卡片位置，
             而卡片被滚出视口时它的 top 会跑到顶栏底下（实测 −48px）——
             不裁就会盖住顶栏。这里在顶栏下缘设一道硬裁切线，
             让过渡产物被裁的位置与**网格被裁的位置完全一致**
             （网格也是被 .view-body 以同一条线裁的），
             于是落点可以照真实卡片矩形算，不需要把目标矩形夹紧
             —— 夹紧会让收尾时"弹回原位"（实际踩过）。 -->
        <div class="detail-clip">
          <AlbumDetailView
            v-if="ui.activeView === 'albums' && ui.detailKey && !searching"
            :album-key="ui.detailKey"
            class="detail-layer scroll-host"
          />
          <!-- 艺术家详情：与专辑详情同架构（覆盖层 + 引力坍缩过渡） -->
          <ArtistDetailView
            v-else-if="ui.activeView === 'artists' && ui.detailKey && !searching"
            :artist-name="ui.detailKey"
            class="detail-layer scroll-host"
          />
        </div>
      </main>
    </div>
    <PlayerBar />
    <SongContextMenu />
    <LyricsFullView v-if="ui.lyricsOpen" />
  </div>
</template>

<style scoped>
.app-shell {
  position: relative; /* 播放条（悬浮玻璃条）的定位基准 */
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.body-row {
  display: flex;
  flex: 1;
  min-height: 0;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 封面氛围光：绝对定位背景层，内容抬到其上 */
.ambient-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

/* 浅色主题整体隐藏氛围光斑（彻底根治顶部「颜色断层」）：
   光斑是低透明度晕染，浅色主题的白底上呈现为一灰带，
   并被 sticky 表头的不透明白底横切出锐利直线——正是用户反复反馈的断层。
   白底极简风格与顶部晕染天然冲突；深色主题深底上晕染协调，保留。 */
[data-theme='light'] .ambient-layer {
  display: none;
}

.ambient-blob {
  position: absolute;
  width: clamp(320px, 36vw, 520px);
  height: clamp(320px, 36vw, 520px);
  border-radius: 50%;
  background: radial-gradient(closest-side, var(--fc), transparent 70%);
  opacity: 0.15;
  animation: ambient-breathe 12s ease-in-out infinite alternate;
  transition: background 1.2s var(--ease-out);
}

.ambient-blob.ab-0 {
  top: -22%;
  left: -6%;
}

.ambient-blob.ab-1 {
  bottom: -26%;
  right: -4%;
  animation-delay: -6s;
}

@keyframes ambient-breathe {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
    opacity: 0.12;
  }
  50% {
    transform: translate(2vw, 2vh) scale(1.08);
    opacity: 0.18;
  }
}

.ambient-enter-active,
.ambient-leave-active {
  transition: opacity 1.2s var(--ease-out);
}

.ambient-enter-from,
.ambient-leave-to {
  opacity: 0;
}

.view-header,
.view-body {
  position: relative;
  z-index: 1;
}

/* 专辑详情覆盖层：盖住标题与网格，自带滚动；放在 .content 内天然避开侧栏与播放条。
   必须保持完全不透明：覆盖层与 body 之间夹着一级界面的网格/封面，
   一旦半透明一级内容就会穿透出来（无论有没有壁纸）。
   注意不加 padding-top：sticky 吸附边界是滚动容器的 padding 内缘，
   顶部留白由详情组件自己带（artist/album-detail 的 padding-top），否则表头
   吸在 20px 处、上缘漏出一条穿行的行。

   top 用 --head-band-h 而不是 0：详情页**保留顶栏**（标题 + 搜索框 + 可拖拽区）。
   原先详情层盖满整个 .content 把顶栏一并埋掉，导致详情自己的返回钮只能往右上角放，
   与窗口控制钮抢位置。让出顶栏一行后，返回钮回归顶栏左侧（标准桌面布局），
   右上角完全归窗口按钮所有。 */
/* 详情层裁切容器：top 与 .view-body 顶边同源（--head-band-h），
   使过渡产物被裁的位置和网格完全一致。overflow:hidden 在这里是**必须**的——
   折叠时整层会被 translate 到卡片矩形，卡片在顶栏底下时层就会越界。
   容器自身不拦事件，交给内部的详情层。 */
.detail-clip {
  position: absolute;
  top: var(--head-band-h);
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  pointer-events: none;
}

.detail-clip > * {
  pointer-events: auto;
}

.detail-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 24px 96px;
  background: var(--bg-base);
}

.view-header {
  /* 顶栏搜索框：基准宽度与聚焦展开宽度（后者供返回钮计算避让位置） */
  --search-w: 260px;
  --search-w-focus: 330px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  /* 内容行高度固定为 --head-row-h，标题 / 搜索框 / 窗口控制钮三者同轴；
     下内边距相应收窄 6px，保持 header 总高不变（20+36+6 = 62），下方内容起始位置不移动。 */
  padding: var(--head-pad-top) 24px 6px;
}

/* 桌面端：窗口控制钮固定悬浮在右上角（不占布局、不推挤内容），
   与顶栏内容行同轴（见 TitleBar.vue）。header 空白区兼作窗口拖拽区
   （data-tauri-drag-region，浏览器端属性无副作用）。 */

/* 顶栏返回：**常驻**在搜索框左侧，位置恒定 —— 不随详情开关忽隐忽现（用户明确要求，
   忽隐忽现会让顶栏看起来杂乱无逻辑）。没有上一级时置灰保留，而不是隐藏。
   定位基准：搜索框左缘钉在「内容区中线 − 半宽」（见 .search-box），
   故本钮右缘 = 中线 − 半宽 − 8px 间隙；用 right 表述即 50% + 半宽 + 8px。
   按**基准宽度**取半宽即可：搜索框聚焦只向右伸展，左缘不动，间距恒定。 */
.head-back {
  position: absolute;
  right: calc(50% + var(--search-w) / 2 + 8px);
  width: var(--head-row-h);
  height: var(--head-row-h);
  display: grid;
  place-items: center;
  border-radius: var(--radius-item);
  /* 描边 + 浅底：与右侧搜索框同材质，让返回钮成为一个「看得见的控件」。
     此前是一枚裸箭头，浅色顶栏上几乎读不出可点性。 */
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

.head-back:hover:not(:disabled) {
  background: var(--bg-active);
  border-color: var(--accent);
  color: var(--accent);
}

.head-back:disabled {
  opacity: 0.3;
  cursor: default;
}

.view-header h1 {
  font-size: 22px;
  font-weight: 600;
  /* 与搜索框同高的一行，保证「板块标题 / 搜索框 / 窗口钮」垂直中心一致 */
  line-height: var(--head-row-h);
  /* 不许压到搜索框：搜索框聚焦半宽 + 间隔 + 页首留白，内容区中线 = 50vw + 侧栏宽/2。
     标题过长时省略。 */
  min-width: 0;
  max-width: calc(50vw - var(--sidebar-w) / 2 - 205px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 顶栏搜索框：水平居中于「侧栏右侧的内容区」。
   .view-header 的 padding box 就是内容区整宽（绝对定位的百分比基准取 padding box，
   故右侧内边距不影响这里的居中），left: 50% 即内容区中线。
   左缘钉在「中线 − 半宽」（translateX 用半宽负数而不是 -50%）：聚焦加宽时**只向右伸展**，
   左缘永远不动 —— 左侧常驻的返回钮因此间距恒定、永不被盖住。 */
.search-box {
  position: absolute;
  left: 50%;
  transform: translateX(calc(var(--search-w) / -2));
  display: flex;
  align-items: center;
  gap: 8px;
  width: var(--search-w);
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-item);
  background: var(--bg-hover);
  border: 1px solid transparent;
  color: var(--text-tertiary);
  transition: width var(--dur-med) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

/* 聚焦加宽：左缘不动，只向右侧空白区伸展 */
.search-box:focus-within {
  width: var(--search-w-focus);
  border-color: var(--accent);
  background: var(--bg-base);
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--text-tertiary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.search-clear:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

/* 底部 padding 即播放条悬浮后的安全空间：标准条与胶囊都是悬浮玻璃条，
   滚动内容会从玻璃后面穿过（这正是液态玻璃可见性的来源），
   一律预留 96px，不再按播放条形态区分 */
.view-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 24px 96px;
}

/* 设置页：各分类的内容高度差很大（外观页高到要滚动，其余页不需要），
   滚动条一出现/消失就会改变内容区宽度 —— 实测「外观」560 vs 其余 568，
   切分类时整个面板横跳 8px。这里为设置页**恒定预留**滚动条槽，宽度不再随内容变化。
   （只作用于设置页，不动全站：全站预留会让本来就够宽的视图凭空窄 8px） */
.view-body.stable-gutter {
  scrollbar-gutter: stable;
}
</style>
