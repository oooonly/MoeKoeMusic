import { toRaw } from 'vue';
import { parseBlob } from 'music-metadata';

const getLocalSongHash = (item) => {
    if (item.hash) return item.hash;
    if (!item.file) return '';
    return `local_${item.name}_${item.file.size}_${item.file.lastModified}`;
};

const getLocalSongCover = (item) => item.cover || item.img || './assets/images/ico.png';

const LOCAL_MUSIC_DB_NAME = 'LocalMusicDB';
const LOCAL_MUSIC_STORE_NAME = 'folderHandles';
const LOCAL_SONG_KEY_PREFIX = 'localSong:';

const isLocalFile = (file) => typeof Blob !== 'undefined' && toRaw(file) instanceof Blob;

const openLocalMusicDB = () => {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not available'));
            return;
        }

        const request = indexedDB.open(LOCAL_MUSIC_DB_NAME);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(LOCAL_MUSIC_STORE_NAME)) {
                db.createObjectStore(LOCAL_MUSIC_STORE_NAME, { keyPath: 'id' });
            }
        };
    });
};

const getLocalStoreItem = async (key) => {
    const db = await openLocalMusicDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LOCAL_MUSIC_STORE_NAME], 'readonly');
        const store = transaction.objectStore(LOCAL_MUSIC_STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const putLocalStoreItem = async (item) => {
    const db = await openLocalMusicDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([LOCAL_MUSIC_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(LOCAL_MUSIC_STORE_NAME);
        const request = store.put(item);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const saveLocalSongHandle = async (hash, item) => {
    const handle = toRaw(item.handle);
    if (!hash || !handle || typeof handle.getFile !== 'function') return;

    try {
        await putLocalStoreItem({
            id: `${LOCAL_SONG_KEY_PREFIX}${hash}`,
            hash,
            handle,
            name: item.name,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('[SongQueue] 淇濆瓨鏈湴姝屾洸鍙ユ焺澶辫触:', error);
    }
};

const getFileFromHandle = async (handle, shouldRequestPermission = true) => {
    const rawHandle = toRaw(handle);
    if (!rawHandle || typeof rawHandle.getFile !== 'function') return null;

    if (typeof rawHandle.queryPermission === 'function') {
        const permission = await rawHandle.queryPermission({ mode: 'read' });
        if (permission !== 'granted') {
            if (!shouldRequestPermission) return null;
            const nextPermission = await rawHandle.requestPermission({ mode: 'read' });
            if (nextPermission !== 'granted') return null;
        }
    }

    return rawHandle.getFile();
};

const resolveLocalSongFile = async (item, hash, shouldRequestPermission = true) => {
    const file = toRaw(item.file);
    if (isLocalFile(file)) return file;

    const handleFile = await getFileFromHandle(item.handle, shouldRequestPermission);
    if (handleFile) return handleFile;

    try {
        const storedSong = await getLocalStoreItem(`${LOCAL_SONG_KEY_PREFIX}${hash}`);
        return await getFileFromHandle(storedSong?.handle, shouldRequestPermission);
    } catch (error) {
        console.error('[SongQueue] 璇诲彇鏈湴姝屾洸鍙ユ焺澶辫触:', error);
        return null;
    }
};

const readLocalSongCover = async (file) => {
    try {
        const metadata = await parseBlob(file);
        const picture = metadata.common.picture?.[0];
        if (!picture) return './assets/images/ico.png';

        const blob = new Blob([picture.data], { type: picture.format });
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error('[SongQueue] 璇诲彇鏈湴姝屾洸灏侀潰澶辫触:', error);
        return './assets/images/ico.png';
    }
};

export default function useLocalMusicQueue(t, musicQueueStore, currentSong, timeoutId) {
    const restoreLocalSongCover = async (localItem) => {
        const localHash = getLocalSongHash(localItem);
        if (!localHash) return '';

        const localFile = await resolveLocalSongFile(localItem, localHash, false);
        if (!localFile) return '';

        return readLocalSongCover(localFile);
    };

    // 娣诲姞鏈湴闊充箰鍒伴槦鍒楀苟鎾斁
    const addLocalMusicToQueue = async (localItem, isReset = true) => {

        const currentSongHash = currentSong.value.hash;
        const localHash = getLocalSongHash(localItem);
        if (!localHash) return { error: true };

        if (typeof window !== 'undefined' && typeof window.electron !== 'undefined') {
            window.electron.ipcRenderer.send('set-tray-title', (localItem.displayName || localItem.name) + ' - ' + (localItem.author || '鏈煡鑹烘湳瀹?));
        }

        try {
            clearTimeout(timeoutId.value);
            const hasCurrentFile = isLocalFile(localItem.file);
            const localFile = await resolveLocalSongFile(localItem, localHash);
            if (!localFile) return { error: true };
            await saveLocalSongHandle(localHash, localItem);
            const localCover = hasCurrentFile ? getLocalSongCover(localItem) : await readLocalSongCover(localFile);
            
            // 璁剧疆褰撳墠姝屾洸淇℃伅
            currentSong.value.author = localItem.author || '鏈煡鑹烘湳瀹?;
            currentSong.value.name = localItem.displayName || localItem.name;
            currentSong.value.img = localCover;
            currentSong.value.hash = localHash;
            currentSong.value.qualityLabel = '';
            currentSong.value.qualityOptions = [];

            // 鍒涘缓鏈湴鏂囦欢鐨?URL
            const url = URL.createObjectURL(localFile);
            currentSong.value.url = url;
            console.log('[SongQueue] 鍒涘缓鏈湴闊充箰URL:', url);

            // 鍒涘缓姝屾洸瀵硅薄
            const song = {
                id: localItem.id || musicQueueStore.queue.length + 1,
                hash: currentSong.value.hash,
                name: currentSong.value.name,
                img: currentSong.value.img,
                author: currentSong.value.author,
                timeLength: localItem.timelen || (localItem.duration * 1000) || localItem.timeLength || 0,
                url: url,
                isLocal: true,
                file: localFile,
                handle: localItem.handle
            };

            // 鏍规嵁鏄惁闇€瑕侀噸缃挱鏀句綅缃?            if (isReset) {
                localStorage.setItem('player_progress', 0);
            }

            // 鏇存柊闃熷垪
            const existingSongIndex = musicQueueStore.queue.findIndex(song => song.hash === currentSong.value.hash);
            if (existingSongIndex === -1) {
                const currentIndex = musicQueueStore.queue.findIndex(song => song.hash == currentSongHash);
                if (currentIndex !== -1) {
                    musicQueueStore.queue.splice(currentIndex + 1, 0, song);
                } else {
                    musicQueueStore.addSong(song);
                }
            } else {
                musicQueueStore.queue[existingSongIndex] = {
                    ...musicQueueStore.queue[existingSongIndex],
                    ...song,
                    id: musicQueueStore.queue[existingSongIndex].id
                };
                currentSong.value = musicQueueStore.queue[existingSongIndex];
            }

            // 杩斿洖姝屾洸瀵硅薄
            return { song };
        } catch (error) {
            console.error('[SongQueue] 鑾峰彇鏈湴闊充箰鍦板潃鍑洪敊:', error);
            currentSong.value.author = currentSong.value.name = t('huo-qu-ben-di-yin-le-di-zhi-shi-bai');
            // if (musicQueueStore.queue.length === 0) return { error: true };
            currentSong.value.author = t('3-miao-hou-zi-dong-qie-huan-xia-yi-shou');

            // 杩斿洖闇€瑕佸垏鎹㈠埌涓嬩竴棣栫殑鏍囧織锛岃€屼笉鏄洿鎺ヨ皟鐢╬laySongFromQueue
            return { error: true, shouldPlayNext: true };
        }
    };

    // 鎵归噺娣诲姞鏈湴闊充箰鍒版挱鏀惧垪琛?    const addLocalPlaylistToQueue = async (localSongs, append = false) => {
        console.log('[SongQueue] 娣诲姞鏈湴鎾斁鍒楄〃:', localSongs.length, '棣栨瓕鏇?);
        
        try {
            let queueSongs = [];
            if (!append) {
                musicQueueStore.clearQueue();
            } else {
                queueSongs = [...musicQueueStore.queue];
            }
            
            const addedHashes = new Set(queueSongs.map(song => song.hash));
            const newSongs = [];
            for (const item of localSongs) {
                const localHash = getLocalSongHash(item);
                if (!localHash || addedHashes.has(localHash)) continue;
                addedHashes.add(localHash);

                const localFile = await resolveLocalSongFile(item, localHash);
                if (!localFile) continue;
                await saveLocalSongHandle(localHash, item);

                const localSong = {
                    id: queueSongs.length + newSongs.length + 1,
                    hash: localHash,
                    name: item.displayName || item.name,
                    author: item.author || '鏈煡鑹烘湳瀹?,
                    img: getLocalSongCover(item),
                    timeLength: item.timelen || (item.duration * 1000) || item.timeLength || 0,
                    url: item.url || '',
                    isLocal: true,
                    file: localFile,
                    handle: item.handle
                };
                newSongs.push(localSong);
            }
            
            // 娣诲姞鍒伴槦鍒?            if (append) {
                musicQueueStore.queue = [...queueSongs, ...newSongs].map((song, index) => ({
                    ...song,
                    id: index + 1
                }));
            } else {
                musicQueueStore.queue = newSongs;
            }
            
            return newSongs;
        } catch (error) {
            console.error('[SongQueue] 娣诲姞鏈湴鎾斁鍒楄〃澶辫触:', error);
            return [];
        }
    };

    return {
        addLocalMusicToQueue,
        addLocalPlaylistToQueue,
        restoreLocalSongCover
    };
}
