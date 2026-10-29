(() => {
  'use strict';

  window.SH_QRMenuSyncContextLoaded = true;

  const MENU_KEY = 'horeca_qr_menu_v1';
  const DEFAULT_LOCAL_CATEGORY_IDS = new Set(['main', 'salads', 'pizza', 'drinks', 'desserts']);
  let syncing = false;

  const cleanName = value => String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

  const isIikoCategory = category => Boolean(
    category && (
      category.source === 'iiko' ||
      category.iikoId ||
      String(category.id || '').startsWith('iiko_cat_')
    )
  );

  const isIikoDish = dish => Boolean(
    dish && (
      dish.source === 'iiko' ||
      dish.iikoId ||
      String(dish.id || '').startsWith('iiko_')
    )
  );

  // Read the editor's CURRENT restaurant-scoped in-memory state. The editor
  // may display a brand-new menu before it has ever written to localStorage.
  // Never read the old shared MENU_KEY or fall back to another restaurant.
  function readState() {
    const editor = window.SH_QRMenuEditor;
    const state = editor?.getState?.();
    return state && Array.isArray(state.categories) && Array.isArray(state.dishes) ? state : null;
  }

  function saveState(state) {
    const editor = window.SH_QRMenuEditor;
    if (!editor?.replaceFromSync) throw new Error('QR Menu ещё не готово. Откройте раздел повторно.');
    editor.replaceFromSync(state);
  }

  function confirmCurrentRestaurant(binding) {
    const editor = window.SH_QRMenuEditor;
    const scope = editor?.getScope?.();
    if (!scope || !scope.restaurantId) {
      throw new Error('Контекст QR Menu ещё не загружен. Откройте раздел повторно.');
    }
    const mode = String(binding?.identity?.mode || binding?.connection?.connectionType || 'RMS').toUpperCase();
    const ids = [...new Set((binding?.departmentIds || []).map(String).filter(Boolean))].sort();
    if (mode === 'CHAIN' && ids.length !== 1) {
      throw new Error('Для QR Menu выберите ровно один ресторан в верхнем фильтре.');
    }
    const restaurantId = ids[0] || String(binding?.identity?.organizationId || binding?.connection?.organizationId || '').trim();
    if (scope.mode !== mode || String(scope.restaurantId) !== restaurantId ||
        (mode === 'CHAIN' && scope.departmentIds.slice().sort().join(',') !== ids.join(','))) {
      throw new Error('Выбор ресторана изменился. Обновите QR Menu и повторите синхронизацию.');
    }
    return editor;
  }

  function normalizeState(state) {
    if (!state || !Array.isArray(state.categories) || !Array.isArray(state.dishes)) return state;

    const originalActive = state.active;
    const categories = [...state.categories].sort((a, b) => Number(isIikoCategory(a)) - Number(isIikoCategory(b)));
    const canonical = [];
    const categoryByName = new Map();
    const categoryIdMap = new Map();

    for (const category of categories) {
      if (!category?.id) continue;
      const key = cleanName(category.name) || `__id:${category.id}`;
      let target = categoryByName.get(key);

      if (!target) {
        target = { ...category };
        canonical.push(target);
        categoryByName.set(key, target);
      } else {
        if (isIikoCategory(category) && !isIikoCategory(target)) target.source = 'mixed';
        if (!target.iikoId && category.iikoId) target.iikoId = category.iikoId;
        if (target.sortOrder == null && category.sortOrder != null) target.sortOrder = category.sortOrder;
      }

      categoryIdMap.set(String(category.id), String(target.id));
    }

    const mergedDishes = [];
    const dishIndex = new Map();

    for (const originalDish of state.dishes) {
      if (!originalDish?.name) continue;
      const dish = { ...originalDish };
      const mappedCategory = categoryIdMap.get(String(dish.cat || ''));
      if (mappedCategory) dish.cat = mappedCategory;

      const price = Number(dish.price || 0);
      const key = `${String(dish.cat || '')}|${cleanName(dish.name)}|${Number.isFinite(price) ? price.toFixed(2) : '0.00'}`;
      const existingIndex = dishIndex.get(key);

      if (existingIndex == null) {
        dishIndex.set(key, mergedDishes.length);
        mergedDishes.push(dish);
        continue;
      }

      const existing = mergedDishes[existingIndex];
      const existingIiko = isIikoDish(existing);
      const currentIiko = isIikoDish(dish);

      if (currentIiko && !existingIiko) {
        mergedDishes[existingIndex] = {
          ...existing,
          ...dish,
          photo: dish.photo || existing.photo || '',
          desc: dish.desc || existing.desc || ''
        };
      } else if (existingIiko && !currentIiko) {
        mergedDishes[existingIndex] = {
          ...dish,
          ...existing,
          photo: existing.photo || dish.photo || '',
          desc: existing.desc || dish.desc || ''
        };
      }
    }

    const dishCountByCategory = new Map();
    for (const dish of mergedDishes) {
      const categoryId = String(dish.cat || '');
      if (!categoryId) continue;
      dishCountByCategory.set(categoryId, (dishCountByCategory.get(categoryId) || 0) + 1);
    }

    const hasIikoCategories = canonical.some(category => isIikoCategory(category));
    const visibleCategories = hasIikoCategories
      ? canonical.filter(category => {
          const id = String(category.id || '');
          const isEmptyDefaultPlaceholder = DEFAULT_LOCAL_CATEGORY_IDS.has(id)
            && !isIikoCategory(category)
            && (dishCountByCategory.get(id) || 0) === 0;
          return !isEmptyDefaultPlaceholder;
        })
      : canonical;

    const validCategoryIds = new Set(visibleCategories.map(category => String(category.id)));
    const mappedActive = categoryIdMap.get(String(originalActive || '')) || String(originalActive || '');

    return {
      ...state,
      categories: visibleCategories,
      dishes: mergedDishes,
      active: validCategoryIds.has(mappedActive) ? mappedActive : (visibleCategories[0]?.id || '')
    };
  }

  function normalizeStoredState() {
    const state = readState();
    if (!state) return;
    const normalized = normalizeState(state);
    if (JSON.stringify(normalized) !== JSON.stringify(state)) saveState(normalized);
  }

  async function sync(button) {
    if (syncing) return;
    syncing = true;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = '↻ Синхронизация...';

    try {
      if (!window.SH_IikoContext?.getBinding) throw new Error('Единое подключение SH Server не готово. Обновите страницу.');
      const binding = await window.SH_IikoContext.getBinding(true);
      if (!binding?.connection) throw new Error('Подключение SH Server не настроено. Откройте «Настройки».');
      const editor = confirmCurrentRestaurant(binding);
      const state = readState();
      if (!state) throw new Error('QR Menu ещё не готово. Откройте раздел повторно.');

      const response = await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/iiko/qr-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ departmentIds: binding.departmentIds || [] })
      }, 90000);
      const data = await response.json().catch(() => ({ success: false, message: 'Некорректный ответ API' }));
      if (!response.ok || !data.success) throw new Error(data.message || `HTTP ${response.status}`);

      // If the restaurant selection changes while the API is working, stop
      // instead of overwriting a different organization's menu.
      const latestBinding = await window.SH_IikoContext.getBinding(true);
      if (window.SH_QRMenuEditor !== editor) throw new Error('QR Menu переключено на другой ресторан.');
      confirmCurrentRestaurant(latestBinding);

      const localCategories = (state.categories || []).filter(category => !isIikoCategory(category));
      const localDishes = (state.dishes || []).filter(dish => !isIikoDish(dish));

      const iikoCategories = (data.categories || []).map(category => ({
        id: `iiko_cat_${category.iikoId}`,
        iikoId: category.iikoId,
        name: category.name,
        source: 'iiko',
        sortOrder: category.sortOrder ?? 0
      }));

      const iikoDishes = (data.products || []).map(product => ({
        id: `iiko_${product.id}`,
        iikoId: product.id,
        cat: `iiko_cat_${product.categoryId}`,
        name: product.name,
        price: product.price ?? 0,
        desc: product.description || '',
        source: 'iiko',
        code: product.code || '',
        num: product.num || '',
        frontImageId: product.frontImageId || null,
        photo: product.photo || '',
        sortOrder: product.sortOrder ?? 0
      }));

      const normalized = normalizeState({
        ...state,
        categories: [...localCategories, ...iikoCategories],
        dishes: [...localDishes, ...iikoDishes]
      });

      saveState(normalized);
      button.textContent = `✓ ${data.productCount ?? iikoDishes.length} блюд`;
      const status = document.getElementById('saveStatus');
      if (status) status.textContent = '● Меню синхронизировано с Smart Horeca Server';
      // Editor rerenders in place. Never reload a form after synchronization.
    } catch (error) {
      alert(`Не удалось синхронизировать меню SH:\n${error?.message || error}`);
      button.textContent = oldText;
    } finally {
      button.disabled = false;
      syncing = false;
    }
  }

  // No startup normalization of legacy global storage: it may belong
  // to a different organization. Normalize only the active editor on sync.

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#syncBtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sync(button);
  }, true);
})();
