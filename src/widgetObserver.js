/*
  Документация по Intersection Observer API https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
  Для использования на публичных сайтах рекомендуется использовать полифилл https://github.com/w3c/IntersectionObserver/tree/master/polyfill
  В данном проекте полифилл подключен в файле main.js
*/

/*
  Самое оптимальное решением с точки зрения производительности -
  установить Intersection Observer (IO) на весь список рекомендаций и рассчитать
  массив пороговых значений строк, при которых будет вызываться коллбек.

  Но это не подойдет для случаев, когда высота списка рекомендаций больше высоты окна,
  потому что IO высчитывает процент попадания элемента во viewport.
  Например, высота списка с рекомендациями 1000px, а высота окна - 300px,
  массив пороговых значений для трех строк - [0.2, 0.5, 0.8].
  Коллбек IO вызовется один раз в случае, когда пользователь увидел ~210px списка с рекомендациями
  (пороговое значение 0.2), а для пороговых значений 0.5 и 0.8 вызываться не будет, так как
  максимальный процент пересечения такого списка с viewport будет 300 / 1000 * 100% = 30%.
  Таким образом, понять когда пользователь увидел вторую и третью строки будет очень сложно.

  В данном примере приводится более универсальное решение
  с добавлением IO для всех рекомендаций по отдельности.
  Пороговое значение устанавливается в 0.5 (пользователь увидел 50% рекомендации),
  а для случая, когда размер рекомендации больше размера окна,
  высчитывается дополнительный корректировочный коэффициент.

  После добавления события показа рекомендации (i_show) выполняется снятие наблюдателя,
  чтобы исключить лишние вызывы коллбеков IO.
*/
import throttle from 'lodash/throttle';

import getEventKey from '@/helpers/getEventKey';
import getCurrentBreakpoint from '@/helpers/getCurrentBreakpoint';
import {
  logInfo,
  logError,
  logGroup,
  logGroupEnd,
} from './helpers/logger';


export default class WidgetObserver {
  constructor({ items, widgetId, breakpoints }) {
    this.items = items;
    this.widgetId = widgetId;
    this.breakpoints = breakpoints;

    // Для последующих расчетов высоты лучше брать список с рекомендациями, а не весь виджет
    this.widgetListElement = document.querySelector(`#${widgetId} ul`);
    this.widgetListItemsElements = this.widgetListElement.querySelectorAll('a');

    this.intersectionObserver = null;
    this.intersectionObserverElements = undefined;
    this.currentBreakpoint = getCurrentBreakpoint(breakpoints);

    /*
      Объект с событиями, которые необходимо отправить (значение false)
      или уже отправлены (значение true).

      Имеет вид:
      events = {
        'widget_id__w_show': false,
        'item_id__i_show': false,
      };
    */
    this.events = null;

    // leading: false позволяет отменить первый моментальный вызов переданной функции
    this.sendEventsThrottled = throttle(this.sendEvents.bind(this), 2000, { leading: false });
    this.handleResize = throttle(this.handleResize.bind(this), 500, { leading: false });
    this.handleClick = this.handleClick.bind(this);
  }

  // массив рекомендаций, который нужно отправить
  get eventsForSend() {
    if (!this.events) return [];

    return Object
      .keys(this.events)
      .filter(key => !this.events[key]);
  }

  // подсчитываем все события со значением true
  get eventsSentCount() {
    if (!this.events) return 0;
    return Object
      .keys(this.events)
      .filter(key => this.events[key])
      .length;
  }

  // количество рекомендаций для текущего брейкпоинта
  get itemsCountForCurrentBreakpoint() {
    if (!this.currentBreakpoint) return 0;

    const maxItems = this.currentBreakpoint.rowsCount * this.currentBreakpoint.columnsCount;
    return this.items.slice(0, maxItems).length || 0;
  }

  init() {
    logInfo('call init');

    if (!this.widgetListElement || typeof this.widgetListElement === 'undefined') {
      logError('Not found DOM element for widget list');
      return;
    }

    if (!this.currentBreakpoint) {
      logError('Not found settings for current breakpoint');
      return;
    }
    logInfo('currentBreakpoint', this.currentBreakpoint);

    this.addResizeObserver();
    this.addIntersectionObserver();

    this.widgetListElement.addEventListener('click', this.handleClick);
  }

  addResizeObserver() {
    logInfo('call addResizeObserver');
    if (!this.breakpoints || this.breakpoints.length <= 1) return;
    window.addEventListener('resize', this.handleResize);
  }

  addIntersectionObserver() {
    logInfo('call addIntersectionObserver');

    const { height: widgetListHeight } = this.widgetListElement.getBoundingClientRect();
    if (!widgetListHeight) {
      logError('Failed to get height for widget list element');
      return;
    }

    const windowHeight = window.innerHeight;
    const { rowsCount, rowsIndents } = this.currentBreakpoint;
    // При текущей верстке высота строк примерно одинаковая,
    // поэтому высоту рекомендации можно посчитать как высоту одной строки
    const widgetListItemHeight = Math
      .floor((widgetListHeight - (rowsCount - 1 * rowsIndents) / rowsCount));
    // Корректировка threshold в случае когда высота элемента больше высоты окна
    const threshold = windowHeight > widgetListItemHeight
      ? 1
      : windowHeight / widgetListItemHeight;

    const options = {
      root: null,
      rootMargin: '0px',
      // 0.5 - если 50% от высоты элемента показалось в области видимости,
      // то будет вызван коллбек IO
      threshold: threshold * 0.5,
    };
    logInfo('threshold for each list item', threshold * 0.5);

    const callback = (entries) => {
      entries.forEach((entry) => {
        logGroup('Intersection Observer callback');
        logInfo('target', entry.target);
        logInfo('isIntersecting', entry.isIntersecting);
        logInfo('intersectionRatio', entry.intersectionRatio);
        if (!entry.isIntersecting || !entry.intersectionRatio) {
          logGroupEnd();
          return;
        }

        const wShowKey = getEventKey(this.widgetId, 'w_show');

        // Добавляем событие показа виджета, если элемент со списком показался во viewport
        if (!this.events || !this.events[wShowKey]) {
          this.events = { ...this.events, [wShowKey]: false };
        }

        const itemId = entry.target.getAttribute('data-item-id');
        if (!itemId) {
          logGroupEnd();
          return;
        }

        const iShowKey = getEventKey(itemId, 'i_show');

        // Если это событие уже есть в объекте events (например после смены брейкпоинта),
        // то можно сразу удалить наблюдатель
        if (this.events && this.events[iShowKey] && this.intersectionObserver) {
          logInfo('the event "i_show" for this element already exists in the object "events". Calling unobserve');
          logGroupEnd();

          this.intersectionObserver.unobserve(entry.target);
          return;
        }

        // Добавляем новое событие показа рекомендации на отправку
        // и снимаем с элемента наблюдатель
        logInfo('add an event "i_show" to the object "events" and call unobserve for this element');
        logGroupEnd();
        this.events = { ...this.events, [iShowKey]: false };
        this.intersectionObserver.unobserve(entry.target);

        // Если есть неотправленные события,
        // то вызываем метод их отправки не чаще, чем раз в 2 секунды
        if (this.eventsForSend.length) this.sendEventsThrottled();
      });
    };

    if (!this.widgetListItemsElements || !this.widgetListItemsElements.length) {
      logError('Failed to get array elements');
      this.removeIntersectionObserver();
      return;
    }

    this.intersectionObserver = new IntersectionObserver(callback, options);
    this.widgetListItemsElements.forEach((element) => {
      this.intersectionObserver.observe(element);
    });
  }

  handleResize() {
    logInfo('call handleResize');
    /*
      Основная логика:
      - Высчитываем брейкпоинт для нового размера окна
      - Если брекйпоинт изменился, то нужно снять старые наблюдатели за рекомендациями
      - Записываем в контекст данные по новому брейкпоинту
      - Объект events обнулять не нужно,
        так как там хранятся данные по отправленным и неотправленным событиям
     */
    const newBreakpoint = getCurrentBreakpoint(this.breakpoints);

    if (!newBreakpoint) {
      logError('Not found settings for new breakpoint');
      return;
    }

    // Если это тот же брейкпоинт, то ничего не делаем
    if (JSON.stringify(newBreakpoint) === JSON.stringify(this.currentBreakpoint)) return;
    // Если кол-во рекомендаций у нового брейкпоинта меньше, чем было уже отправлено,
    // то ничего не делаем
    if (newBreakpoint.rowsCount * newBreakpoint.columnsCount <= this.eventsSentCount) return;

    logInfo('newCurrentBreakpoint', newBreakpoint);
    this.currentBreakpoint = newBreakpoint;

    // На случай, если ресайз произошел сразу или еще не все события отправлены
    this.removeIntersectionObserver();
    this.addIntersectionObserver();
  }

  handleClick({ target }) {
    if (!target) return;

    // TODO: Для IE11 нужен полифилл для метода .closest
    const targetElementClosest = target.closest('[data-item-id]');
    if (!targetElementClosest) return;

    const dataItemId = targetElementClosest.getAttribute('data-item-id');
    if (dataItemId) this.sendClickEvent(dataItemId);
  }

  sendClickEvent(itemId) {
    const iClickKey = getEventKey(itemId, 'i_click');
    this.events = { ...this.events, [iClickKey]: false };

    this.sendEvents();
  }

  sendEvents() {
    logGroup('call sendEvents');
    // Убираем из массива неотправленных событий лишние данные
    const events = this.eventsForSend.map((eventForSend) => {
      const [id, type] = eventForSend.split('__');

      // Для события `i_show` требуется передать itemId
      if (type === 'w_show') return { type };
      return { type, itemId: id };
    });

    /*
      И отправляем их

      aiturec('event', 'w_events', {
        widgetId: this.widgetId,
        events,
      });
    */
    logInfo('events for send', events);

    // После этого нужно пометить отправленные события со значением true
    const sentEvents = this.eventsForSend.reduce((sum, current) => ({
      ...sum,
      [current]: true,
    }), this.events);

    this.events = {
      ...this.events,
      ...sentEvents,
    };

    logInfo('events object', this.events);

    // Если отправлены события для всех рекомендаций и событие показа виджета,
    // то нужно снять все наблюдатели
    if (this.eventsSentCount === this.items.length + 1) {
      logInfo('all events for all breakpoints sent');
      this.removeIntersectionObserver();
      this.removeResizeObserver();
      logGroupEnd();
      return;
    }

    // Если отправлены все возможные события для текущего брейкпоинта,
    // то нужно снять наблюдение с рекомендаций
    if (this.eventsSentCount === this.itemsCountForCurrentBreakpoint + 1) {
      logInfo('all events for current breakpoint sent');
      this.removeIntersectionObserver();
    }
    logGroupEnd();
  }

  removeIntersectionObserver() {
    logInfo('call removeIntersectionObserver');
    if (!this.intersectionObserver) return;
    // Метод disconnect позволяет снять наблюдение со всех элементов сразу,
    // но имеет плохую поддержку
    if (this.intersectionObserver.disconnect) this.intersectionObserver.disconnect();
    else {
      if (!this.intersectionObserverElements) return;
      this.intersectionObserverElements.forEach((element) => {
        this.intersectionObserver.unobserve(element);
      });
    }
    this.intersectionObserver = null;
  }

  removeResizeObserver() {
    logInfo('call removeResizeObserver');
    if (!this.breakpoints || this.breakpoints.length <= 1) return;
    window.removeEventListener('resize', this.handleResize);
  }

  destroy() {
    // Проверяем наличие неотправленных событий и отправляем их без задержки
    logInfo('call destroy');
    if (this.events && this.eventsForSend.length) this.sendEvents();

    this.events = null;
    this.currentBreakpoint = null;
    this.widgetListElement = null;
    this.widgetListItemsElements = null;

    window.removeEventListener('click', this.handleClick);

    this.removeIntersectionObserver();
    this.removeResizeObserver();
  }
}
