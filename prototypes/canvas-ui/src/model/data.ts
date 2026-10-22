// PROTOTYPE - fake in-memory content. Nothing here is real data.

export type QType = 'open' | 'single' | 'multi';

export interface Target {
  id: string;
  name: string;
  grade: string;
  interviewDate: string | null;
  daysLeft: number | null;
}

export interface Topic {
  id: string;
  group: string;
  name: string;
  targets: string[];
  mastery: number; // 0..1
  due: number;
}

export interface Question {
  id: string;
  topicId: string;
  type: QType;
  text: string;
  options?: string[];
  correct?: number[];
  keyIdea: string; // short Reference answer summary
  gap: string; // what is usually missed
}

export interface Proposed {
  id: string;
  kind: 'topic' | 'question';
  title: string;
  topic: string;
  source: string;
  targetId: string;
}

export const TARGETS: Target[] = [
  { id: 'net', name: 'Backend C#/.NET', grade: 'Middle+', interviewDate: '14 ноября', daysLeft: 23 },
  { id: 'js', name: 'Fullstack JS', grade: 'Middle', interviewDate: null, daysLeft: null },
];

export const TOPICS: Topic[] = [
  { id: 'async', group: 'C# и .NET', name: 'async/await', targets: ['net'], mastery: 0.72, due: 2 },
  { id: 'gc', group: 'C# и .NET', name: 'Сборщик мусора (GC)', targets: ['net'], mastery: 0.34, due: 3 },
  { id: 'linq', group: 'C# и .NET', name: 'LINQ', targets: ['net'], mastery: 0.86, due: 0 },
  { id: 'di', group: 'C# и .NET', name: 'DI и время жизни сервисов', targets: ['net'], mastery: 0.58, due: 1 },
  { id: 'ef', group: 'Данные', name: 'EF Core', targets: ['net'], mastery: 0.45, due: 2 },
  { id: 'pgidx', group: 'Данные', name: 'Индексы PostgreSQL', targets: ['net', 'js'], mastery: 0.28, due: 3 },
  { id: 'iso', group: 'Данные', name: 'Изоляция транзакций', targets: ['net', 'js'], mastery: 0.52, due: 2 },
  { id: 'http', group: 'Сеть и архитектура', name: 'HTTP', targets: ['net', 'js'], mastery: 0.81, due: 0 },
  { id: 'sd', group: 'Сеть и архитектура', name: 'Основы system design', targets: ['net', 'js'], mastery: 0.2, due: 1 },
  { id: 'loop', group: 'JavaScript', name: 'Event loop', targets: ['js'], mastery: 0.66, due: 1 },
  { id: 'prom', group: 'JavaScript', name: 'Промисы', targets: ['js'], mastery: 0.5, due: 2 },
  { id: 'react', group: 'Фронтенд', name: 'React: рендеринг', targets: ['js'], mastery: 0.4, due: 2 },
  { id: 'ts', group: 'Фронтенд', name: 'TypeScript generics', targets: ['js'], mastery: 0.7, due: 0 },
  { id: 'streams', group: 'JavaScript', name: 'Node.js streams', targets: ['js'], mastery: 0.24, due: 1 },
];

export const QUESTIONS: Question[] = [
  {
    id: 'q1', topicId: 'async', type: 'open',
    text: 'Что происходит, когда выполнение доходит до await незавершённой задачи? Какую роль играет SynchronizationContext?',
    keyIdea: 'метод возвращает управление, продолжение регистрируется на задаче и выполняется через захваченный контекст',
    gap: 'не сказано, что поток не блокируется и где выполнится продолжение',
  },
  {
    id: 'q2', topicId: 'async', type: 'single',
    text: 'Что получает вызывающий код от метода async void?',
    options: ['Task, который можно дождаться', 'Ничего: дождаться завершения и поймать исключение нельзя', 'ValueTask', 'Task<object>'],
    correct: [1], keyIdea: 'async void нельзя дождаться, исключения уходят в контекст', gap: '',
  },
  {
    id: 'q3', topicId: 'async', type: 'multi',
    text: 'Какие утверждения о ConfigureAwait(false) верны?',
    options: ['Продолжение может выполниться на другом потоке', 'Ускоряет сам await в два раза', 'Полезен в библиотечном коде', 'В ASP.NET Core эффект минимален: SynchronizationContext там нет'],
    correct: [0, 2, 3], keyIdea: 'отказ от захвата контекста', gap: '',
  },
  {
    id: 'q4', topicId: 'gc', type: 'open',
    text: 'Как устроены поколения в .NET GC и зачем нужна Large Object Heap?',
    keyIdea: 'поколения 0/1/2 опираются на гипотезу о коротком времени жизни; LOH хранит крупные объекты и не уплотняется по умолчанию',
    gap: 'не упомянута фрагментация LOH и порог в 85 000 байт',
  },
  {
    id: 'q5', topicId: 'gc', type: 'single',
    text: 'Объект какого размера по умолчанию попадает в LOH?',
    options: ['От 85 000 байт', 'От 1 МБ', 'От 8 КБ', 'Любой массив'],
    correct: [0], keyIdea: 'порог 85 000 байт', gap: '',
  },
  {
    id: 'q6', topicId: 'gc', type: 'open',
    text: 'Чем Dispose отличается от финализатора? Когда нужен паттерн Dispose(bool)?',
    keyIdea: 'Dispose детерминированно освобождает ресурсы, финализатор страхует неуправляемые ресурсы; Dispose(bool) разделяет оба пути',
    gap: 'не сказано про GC.SuppressFinalize',
  },
  {
    id: 'q7', topicId: 'linq', type: 'single',
    text: 'Когда выполняется запрос var q = list.Where(x => x > 5)?',
    options: ['Сразу при объявлении', 'При перечислении результата', 'При компиляции', 'Только при вызове ToList()'],
    correct: [1], keyIdea: 'отложенное выполнение', gap: '',
  },
  {
    id: 'q8', topicId: 'di', type: 'open',
    text: 'Что будет, если внедрить Scoped-сервис в Singleton? Как ASP.NET Core это обнаруживает?',
    keyIdea: 'captive dependency: scoped-объект живёт вечно; ValidateScopes в Development бросает исключение',
    gap: 'не упомянут ValidateScopes или IServiceScopeFactory как решение',
  },
  {
    id: 'q9', topicId: 'ef', type: 'open',
    text: 'Что такое проблема N+1 в EF Core и как её избежать?',
    keyIdea: 'один запрос за списком и по запросу на каждую строку; лечится Include, проекцией через Select или split query',
    gap: 'не сказано, как обнаружить проблему: логирование SQL или профайлер',
  },
  {
    id: 'q10', topicId: 'ef', type: 'multi',
    text: 'Что делает AsNoTracking()?',
    options: ['Отключает отслеживание изменений для результата', 'Ускоряет чтение, если сущности не будут меняться', 'Навсегда запрещает ленивую загрузку', 'Позволяет SaveChanges сохранить изменения этих сущностей'],
    correct: [0, 1], keyIdea: 'нет change tracking', gap: '',
  },
  {
    id: 'q11', topicId: 'pgidx', type: 'open',
    text: 'Почему запрос с WHERE lower(email) = $1 не использует индекс по email? Как исправить?',
    keyIdea: 'индекс построен по значению столбца, а не по выражению; нужен индекс по выражению lower(email) или citext',
    gap: 'не предложен индекс по выражению',
  },
  {
    id: 'q12', topicId: 'pgidx', type: 'single',
    text: 'Какой индекс подходит для поиска по jsonb оператором @>?',
    options: ['B-tree', 'GIN', 'Hash', 'BRIN'],
    correct: [1], keyIdea: 'GIN', gap: '',
  },
  {
    id: 'q13', topicId: 'pgidx', type: 'open',
    text: 'Что такое покрывающий индекс и когда PostgreSQL выбирает Index Only Scan?',
    keyIdea: 'индекс содержит все нужные столбцы (INCLUDE); Index Only Scan возможен, если страницы отмечены в visibility map',
    gap: 'не упомянута visibility map и роль VACUUM',
  },
  {
    id: 'q14', topicId: 'iso', type: 'open',
    text: 'Какие аномалии допускает Read Committed в PostgreSQL и как от них защититься?',
    keyIdea: 'неповторяемое чтение и фантомы, потерянное обновление; защита: SELECT FOR UPDATE, Repeatable Read или Serializable с повтором',
    gap: 'не сказано, что при Serializable нужно повторять транзакцию при ошибке сериализации',
  },
  {
    id: 'q15', topicId: 'iso', type: 'single',
    text: 'Какой уровень изоляции в PostgreSQL используется по умолчанию?',
    options: ['Read Uncommitted', 'Read Committed', 'Repeatable Read', 'Serializable'],
    correct: [1], keyIdea: 'Read Committed', gap: '',
  },
  {
    id: 'q16', topicId: 'http', type: 'multi',
    text: 'Какие методы HTTP идемпотентны?',
    options: ['GET', 'PUT', 'POST', 'DELETE'],
    correct: [0, 1, 3], keyIdea: 'GET, PUT, DELETE', gap: '',
  },
  {
    id: 'q17', topicId: 'http', type: 'open',
    text: 'Чем отличаются коды 401 и 403?',
    keyIdea: '401 означает, что клиент не аутентифицирован; 403 означает, что прав не хватает',
    gap: 'не упомянут заголовок WWW-Authenticate',
  },
  {
    id: 'q18', topicId: 'sd', type: 'open',
    text: 'Как спроектировать сокращатель ссылок на 1000 RPS? Назовите ключевые компоненты.',
    keyIdea: 'генерация ключа, хранилище ключ→URL, кэш на чтение, редирект 301/302, оценка объёма',
    gap: 'нет оценки объёма данных и стратегии кэширования',
  },
  {
    id: 'q19', topicId: 'loop', type: 'open',
    text: 'В каком порядке выполнятся синхронный код, Promise.then и setTimeout(0)? Почему?',
    keyIdea: 'сначала синхронный код, затем микрозадачи (then), затем макрозадачи (setTimeout)',
    gap: 'не объяснена очередь микрозадач',
  },
  {
    id: 'q20', topicId: 'loop', type: 'single',
    text: 'Что выведет console.log(typeof null)?',
    options: ["'null'", "'object'", "'undefined'", 'Ошибка'],
    correct: [1], keyIdea: "'object'", gap: '',
  },
  {
    id: 'q21', topicId: 'react', type: 'open',
    text: 'Почему компонент React перерисовывается и как убрать лишние рендеры?',
    keyIdea: 'рендер при изменении state, props или контекста и при рендере родителя; memo, стабильные ссылки, разделение состояния',
    gap: 'не сказано, что рендер родителя перерисовывает детей без memo',
  },
  {
    id: 'q22', topicId: 'prom', type: 'single',
    text: 'Что возвращает Promise.allSettled?',
    options: ['Первый выполненный промис', 'Массив статусов всех промисов после их завершения', 'Отклоняется при первой ошибке', 'Только успешные результаты'],
    correct: [1], keyIdea: 'массив {status, value|reason}', gap: '',
  },
  {
    id: 'q23', topicId: 'streams', type: 'open',
    text: 'Что такое backpressure в Node.js streams и как с ним работать?',
    keyIdea: 'потребитель медленнее источника; write() возвращает false, ждём drain или используем pipeline',
    gap: 'не упомянут pipeline() или событие drain',
  },
  {
    id: 'q24', topicId: 'ts', type: 'multi',
    text: 'Что верно про K extends keyof T?',
    options: ['K может быть только ключом типа T', 'K становится строкой любого вида', 'Позволяет типизировать T[K]', 'Работает только с классами'],
    correct: [0, 2], keyIdea: 'ограничение ключами T', gap: '',
  },
];

export interface MockStep {
  text: string;
  topicId: string;
  comment: string; // what the Interviewer says in Chat before placing the Card
}

export const MOCK_SCRIPTS: Record<string, MockStep[]> = {
  net: [
    { topicId: 'ef', text: 'Эндпоинт списка заказов на ASP.NET Core + EF Core отвечает 3 секунды. С чего начнёте ускорять?', comment: 'Начнём. Представьте, что вы пришли в команду и видите медленный эндпоинт.' },
    { topicId: 'pgidx', text: 'Вы упомянули индексы. Как проверите, что запрос действительно их использует?', comment: 'Хорошо, уточню про индексы.' },
    { topicId: 'pgidx', text: 'План показывает Seq Scan, хотя индекс есть. Какие могут быть причины?', comment: 'Копнём глубже.' },
  ],
  js: [
    { topicId: 'react', text: 'Страница со списком из 2000 строк тормозит при вводе в поиск. Ваши действия?', comment: 'Начнём с практической ситуации.' },
    { topicId: 'react', text: 'Вы предложили memo. Почему он может не сработать?', comment: 'Уточню.' },
    { topicId: 'loop', text: 'Как перенести тяжёлую фильтрацию, чтобы не блокировать ввод?', comment: 'И последний вопрос по теме.' },
  ],
};

export const INITIAL_PROPOSED: Proposed[] = [
  { id: 'p1', kind: 'topic', title: 'Каналы: System.Threading.Channels', topic: 'C# и .NET', source: 'hh.ru: упоминается в 12 вакансиях Middle .NET', targetId: 'net' },
  { id: 'p2', kind: 'question', title: 'Чем Span<T> отличается от Memory<T>?', topic: 'C# и .NET', source: 'Habr: «Span<T> на практике»', targetId: 'net' },
  { id: 'p3', kind: 'question', title: 'Как работает MVCC в PostgreSQL?', topic: 'Изоляция транзакций', source: 'Документация PostgreSQL 17, глава 13', targetId: 'net' },
  { id: 'p4', kind: 'question', title: 'Что такое Outbox-паттерн и зачем он нужен?', topic: 'Основы system design', source: 'Вакансия: Middle .NET, маркетплейс', targetId: 'net' },
  { id: 'p5', kind: 'question', title: 'Чем useEffect отличается от useLayoutEffect?', topic: 'React: рендеринг', source: 'react.dev: Synchronizing with Effects', targetId: 'js' },
];

export const RESEARCH_BATCH: Proposed[] = [
  { id: 'p6', kind: 'question', title: 'Когда использовать IAsyncEnumerable<T>?', topic: 'async/await', source: 'learn.microsoft.com: Generate and consume async streams', targetId: 'net' },
  { id: 'p7', kind: 'question', title: 'Как работает пул соединений Npgsql?', topic: 'EF Core', source: 'Документация Npgsql: Connection pooling', targetId: 'net' },
  { id: 'p8', kind: 'question', title: 'Что такое structuredClone и чем он лучше JSON-копии?', topic: 'JavaScript', source: 'MDN: structuredClone()', targetId: 'js' },
];

export const CHAT_REPLIES = [
  'Понял. Предлагаю сначала закрыть пробелы по GC: там три вопроса в повторении.',
  'Хороший вопрос. На собеседованиях Middle+ про это обычно спрашивают через практический кейс, а не определение.',
  'Могу собрать короткий квиз на 4 теста, чтобы быстро проверить базу. Нажмите «Квиз» или «Подборка на сегодня».',
];
