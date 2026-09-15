(() => {
  'use strict';

  const MENU_KEY = 'horeca_qr_menu_v1';
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

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MENU_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveState(state) {
    localStorage.setItem(MENU_KEY, JSON.stringify(state));
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

    const validCategoryIds = new Set(canonical.map(category => String(category.id)));
    const mappedActive = categoryIdMap.get(String(originalActive || '')) || String(originalActive || '');

    return {
      ...state,
      categories: canonical,
      dishes: mergedDishes,
      active: validCategoryIds.has(mappedActive) ? mappedActive : (canonical[0]?.id || '')
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

      const response = await fetch('/api/iiko/qr-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ departmentIds: binding.departmentIds || [] })
      });
      const data = await response.json().catch(() => ({ success: false, message: 'Некорректный ответ API' }));
      if (!response.ok || !data.success) throw new Error(data.message || `HTTP ${response.status}`);

      const state = readState();
      if (!state) throw new Error('Локальное состояние QR Menu не найдено. Обновите страницу.');

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
      setTimeout(() => location.reload(), 350);
    } catch (error) {
      alert(`Не удалось синхронизировать меню SH:\n${error?.message || error}`);
      button.disabled = false;
      button.textContent = oldText;
      syncing = false;
    }
  }

  normalizeStoredState();

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#syncBtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sync(button);
  }, true);
})();
