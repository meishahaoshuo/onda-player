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
 * 浮动胶囊模式下，非列表视图的滚动内容末尾预留胶囊高度，
 * 避免页面底部的功能按钮被悬浮胶囊遮挡。
 * 列表视图（charts 与 SongList 系均为 height:100% + 内部滚动的同构布局，
 * 容器 padding 会把它们压短造成「隔断」）不加——
 * 尾部安全空间由各自的滚动容器内部提供（VirtualList tail / list-body padding）。
 */
const LIST_VIEWS = ['songs', 'favorites', 'recent', 'folders', 'charts']
const viewCapsulePad = computed(
  () => settings.playerStyle === 'capsule' && !LIST_VIEWS.includes(ui.activeView),
)

/** 是否有搜索关键词（内容区被搜索结果接管） */
const searching = computed(() => ui.searchQuery.trim().length > 0)
const { scope: searchScope } = useSearchScope()
const searchPlaceholder = computed(() =>
  searchScope.value.scoped
    ? `在「${searchScope.value.label}」中搜索`
    : '搜索歌曲、艺术家、专辑',
)

/* ---------- 全应用滚动位置记忆 ----------
   切视图 / 钻取详情前把旧容器的 scrollTop 记入 ui store，
   回来时（Transition enter 或同视图钻取返回）恢复。
   key：`view:<视图>|<detailKey>`；SongList/VirtualList 的内部滚动由组件自己记（list:*）。 */
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
    if (!settings.ambientGlow || !coverId) {
      ambientColors.value = []
      return
    }
    const seq = ++ambientSeq
    try {
      const url = await library.coverUrl(coverId)
      if (!url || seq !== ambientSeq) return
      const blob = await (await fetch(url)).blob()
      const colors = await extractBrightColors(blob).catch(() => [] as string[])
      if (seq !== ambientSeq || !settings.ambientGlow) return
      ambientColors.value = colors.length > 0 ? colors.slice(0, 2) : [null, null]
    } catch {
      /* 取色失败保持无氛围光 */
    }
  },
  { immediate: true },
)

// 关闭氛围光开关时清空
watch(
  () => settings.ambientGlow,
  (on) => {
    if (!on) ambientColors.value = []
  },
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
        <div class="body-row">
      <Sidebar />
      <main class="content">
        <!-- 封面氛围光：跟随当前播放封面取色的低强度背景光斑 -->
        <div v-if="settings.ambientGlow && player.current?.coverId" class="ambient-layer" aria-hidden="true">
          <Transition v-for="(c, i) in ambientColors" :key="`${player.currentPath}-${i}`" name="ambient">
            <div v-if="c" class="ambient-blob" :class="`ab-${i}`" :style="{ '--fc': c }" />
          </Transition>
        </div>
        <header class="view-header">
          <h1>{{ title }}</h1>
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
            class="view-body"
            :class="{ 'capsule-pad': viewCapsulePad }"
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
        <AlbumDetailView
          v-if="ui.activeView === 'albums' && ui.detailKey && !searching"
          :album-key="ui.detailKey"
          class="detail-layer"
        />
        <!-- 艺术家详情：与专辑详情同架构（覆盖层 + 引力坍缩过渡） -->
        <ArtistDetailView
          v-else-if="ui.activeView === 'artists' && ui.detailKey && !searching"
          :artist-name="ui.detailKey"
          class="detail-layer"
        />
      </main>
    </div>
    <PlayerBar />
    <SongContextMenu />
    <LyricsFullView v-if="ui.lyricsOpen" />
  </div>
</template>

<style scoped>
.app-shell {
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
   一旦半透明一级内容就会穿透出来（无论有没有壁纸）。 */
.detail-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 24px 24px;
  background: var(--bg-base);
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 12px;
}

.view-header h1 {
  font-size: 22px;
  font-weight: 600;
}

/* 顶栏搜索框：聚焦时轻微加宽 */
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 260px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-item);
  background: var(--bg-hover);
  border: 1px solid transparent;
  color: var(--text-tertiary);
  transition: width var(--dur-med) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.search-box:focus-within {
  width: 330px;
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

.view-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 24px 24px;
}

/* 浮动胶囊模式：非列表视图的滚动内容末尾预留胶囊高度（防遮底部功能按钮）。
   列表视图（songs/favorites/recent/folders）不加——容器 padding 会压短
   height:100% 的虚拟列表（行在胶囊上缘截断），其尾部空间走 VirtualList tail。 */
.view-body.capsule-pad {
  padding-bottom: 96px;
}
</style>
