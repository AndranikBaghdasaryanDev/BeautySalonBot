import type { SalonConfig } from "../config.ts";
import type { Lang } from "../i18n.ts";

/**
 * All customer-facing text lives here, separate from handler logic, in every
 * supported language. Messages use HTML parse mode.
 */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const COMMANDS = ["start", "services", "contact", "language", "privacy", "delete_my_data", "help"] as const;
export type CommandName = (typeof COMMANDS)[number];

interface Texts {
  readonly buttons: {
    readonly services: string;
    readonly contact: string;
    readonly privacy: string;
    readonly help: string;
    readonly language: string;
    readonly confirmDelete: string;
    readonly cancelDelete: string;
  };
  readonly commands: Readonly<Record<CommandName, string>>;
  readonly welcomeNew: (salon: string, name: string) => string;
  readonly welcomeBack: (name: string) => string;
  readonly menuHint: string;
  readonly helpTitle: (salon: string) => string;
  readonly servicesTitle: (salon: string) => string;
  readonly servicesEmpty: string;
  readonly priceNote: string;
  readonly privacy: (salon: string) => string;
  readonly languageChosen: string;
  readonly privateChatOnly: string;
  readonly deleteConfirm: string;
  readonly deleteDone: string;
  readonly deleteNothing: string;
  readonly deleteCancelled: string;
  readonly genericError: string;
  readonly unknownInput: string;
}

const hy: Texts = {
  buttons: {
    services: "💅 Ծառայություններ",
    contact: "📍 Կոնտակտներ",
    privacy: "🔒 Գաղտնիություն",
    help: "❓ Օգնություն",
    language: "🌐 Լեզու",
    confirmDelete: "Այո, ջնջել իմ տվյալները",
    cancelDelete: "Չեղարկել",
  },
  commands: {
    start: "Գլխավոր մենյու",
    services: "Մեր ծառայությունները",
    contact: "Հասցե և կոնտակտներ",
    language: "Փոխել լեզուն",
    privacy: "Ինչպես ենք պահում ձեր տվյալները",
    delete_my_data: "Ջնջել ձեր տվյալները",
    help: "Ինչ կարող է անել բոտը",
  },
  welcomeNew: (salon, name) => `Բարի գալուստ <b>${salon}</b>${name}։ ✨`,
  welcomeBack: (name) => `Ուրախ ենք կրկին տեսնել ձեզ${name}։ ✨`,
  menuHint: "Ընտրեք ստորև, որպեսզի տեսնեք մեր ծառայությունները և կոնտակտները։",
  helpTitle: (salon) => `<b>${salon}</b> — հրամաններ`,
  servicesTitle: (salon) => `<b>${salon} — ծառայություններ</b>`,
  servicesEmpty: "Ծառայությունների ցանկը թարմացվում է։ Մանրամասների համար կապվեք մեզ հետ։",
  priceNote: "Գների և ազատ ժամերի համար կապվեք մեզ հետ՝ /contact",
  privacy: (salon) =>
    [
      "<b>Գաղտնիություն</b>",
      "",
      `Երբ սեղմում եք /start, <b>${salon}</b>-ը ավտոմատ պահպանում է այն տեղեկությունները, որոնք Telegram-ը տրամադրում է ցանկացած բոտի․`,
      "• ձեր Telegram ID-ն և չատի ID-ն",
      "• username-ը, անունը և ազգանունը, եթե դրանք նշված են",
      "• Telegram հավելվածի լեզուն և ձեր ընտրած լեզուն",
      "• ձեր պրոֆիլի նկարի հղումը, եթե այն տեսանելի է բոտերին",
      "• գրանցման և վերջին այցի ժամանակը",
      "",
      "Մենք <b>չենք</b> հարցնում և չենք պահում հեռախոսահամարներ, ծննդյան օրեր կամ Telegram-ի bio։",
      "",
      "Այս տվյալներն օգտագործվում են միայն ձեզ ճանաչելու և սպասարկելու համար։ Դրանք չեն վաճառվում և չեն փոխանցվում այլոց։",
      "",
      "Ցանկացած պահի կարող եք ջնջել դրանք՝ /delete_my_data",
    ].join("\n"),
  languageChosen: "Լեզուն՝ 🇦🇲 Հայերեն",
  privateChatOnly: "Ձեր գաղտնիության համար օգտագործեք այս հրամանը բոտի հետ անձնական չատում։",
  deleteConfirm:
    "Համոզվա՞ծ եք։ Ձեր մասին մեր պահած բոլոր տվյալները կջնջվեն ընդմիշտ։ Հետագայում կարող եք կրկին գրանցվել՝ /start",
  deleteDone: "Ձեր տվյալները ջնջված են։ Շնորհակալություն, որ այցելեցիք մեզ 💐",
  deleteNothing: "Մենք ձեր մասին պահված տվյալներ չունենք։",
  deleteCancelled: "Ջնջումը չեղարկվեց։ Ձեր տվյալները չեն փոխվել։",
  genericError: "Կներեք, մեր կողմում սխալ առաջացավ։ Խնդրում ենք փորձել մի փոքր ուշ։",
  unknownInput: "Չհասկացա։ Օգտվեք ստորև մենյուից կամ /help հրամանից։",
};

const ru: Texts = {
  buttons: {
    services: "💅 Услуги",
    contact: "📍 Контакты",
    privacy: "🔒 Конфиденциальность",
    help: "❓ Помощь",
    language: "🌐 Язык",
    confirmDelete: "Да, удалить мои данные",
    cancelDelete: "Отмена",
  },
  commands: {
    start: "Главное меню",
    services: "Наши услуги",
    contact: "Адрес и контакты",
    language: "Сменить язык",
    privacy: "Как мы храним ваши данные",
    delete_my_data: "Удалить ваши данные",
    help: "Что умеет бот",
  },
  welcomeNew: (salon, name) => `Добро пожаловать в <b>${salon}</b>${name}! ✨`,
  welcomeBack: (name) => `Рады снова вас видеть${name}! ✨`,
  menuHint: "Выберите пункт ниже, чтобы посмотреть наши услуги и контакты.",
  helpTitle: (salon) => `<b>${salon}</b> — команды`,
  servicesTitle: (salon) => `<b>${salon} — услуги</b>`,
  servicesEmpty: "Список услуг обновляется. Свяжитесь с нами, чтобы узнать подробности.",
  priceNote: "Цены и свободное время уточняйте у нас: /contact",
  privacy: (salon) =>
    [
      "<b>Конфиденциальность</b>",
      "",
      `Когда вы нажимаете /start, <b>${salon}</b> автоматически сохраняет информацию, которую Telegram передаёт любому боту:`,
      "• ваш Telegram ID и ID чата",
      "• username, имя и фамилию, если они указаны",
      "• язык приложения Telegram и выбранный вами язык",
      "• ссылку на фото профиля, если оно доступно ботам",
      "• время регистрации и последнего визита",
      "",
      "Мы <b>не</b> запрашиваем и не храним номера телефонов, даты рождения и bio в Telegram.",
      "",
      "Эти данные используются только для того, чтобы узнавать и обслуживать вас. Они не продаются и не передаются третьим лицам.",
      "",
      "Вы можете удалить их в любой момент: /delete_my_data",
    ].join("\n"),
  languageChosen: "Язык: 🇷🇺 Русский",
  privateChatOnly: "В целях конфиденциальности используйте эту команду в личном чате с ботом.",
  deleteConfirm:
    "Вы уверены? Все данные, которые мы храним о вас, будут удалены навсегда. Позже вы сможете снова зарегистрироваться: /start",
  deleteDone: "Ваши данные удалены. Спасибо, что были с нами 💐",
  deleteNothing: "У нас нет сохранённых данных о вас.",
  deleteCancelled: "Удаление отменено. Ваши данные не изменились.",
  genericError: "Извините, на нашей стороне произошла ошибка. Пожалуйста, попробуйте чуть позже.",
  unknownInput: "Не понял вас. Воспользуйтесь меню ниже или командой /help.",
};

const en: Texts = {
  buttons: {
    services: "💅 Services",
    contact: "📍 Contact",
    privacy: "🔒 Privacy",
    help: "❓ Help",
    language: "🌐 Language",
    confirmDelete: "Yes, delete my data",
    cancelDelete: "Cancel",
  },
  commands: {
    start: "Main menu",
    services: "Our services",
    contact: "Address and contacts",
    language: "Change language",
    privacy: "How we handle your data",
    delete_my_data: "Delete your stored data",
    help: "What this bot can do",
  },
  welcomeNew: (salon, name) => `Welcome to <b>${salon}</b>${name}! ✨`,
  welcomeBack: (name) => `Welcome back${name}! ✨`,
  menuHint: "Choose an option below to see our services and contact details.",
  helpTitle: (salon) => `<b>${salon}</b> — commands`,
  servicesTitle: (salon) => `<b>${salon} — services</b>`,
  servicesEmpty: "Our service list is being updated. Please contact us for details.",
  priceNote: "Contact us for prices and available times: /contact",
  privacy: (salon) =>
    [
      "<b>Privacy</b>",
      "",
      `When you press /start, <b>${salon}</b> automatically stores the information Telegram shares with every bot:`,
      "• your Telegram user ID and chat ID",
      "• username, first and last name, if you have set them",
      "• your Telegram app language and the language you chose",
      "• a reference to your profile photo, if it is visible to bots",
      "• when you registered and when you last used the bot",
      "",
      "We do <b>not</b> ask for or store phone numbers, birthdays or your Telegram bio.",
      "",
      "We use this information only to recognise and serve you. It is not sold or shared.",
      "",
      "You can delete it at any time: /delete_my_data",
    ].join("\n"),
  languageChosen: "Language: 🇬🇧 English",
  privateChatOnly: "For your privacy, please use this command in a private chat with the bot.",
  deleteConfirm:
    "Are you sure? This permanently deletes all information we store about you. You can register again later with /start.",
  deleteDone: "Your data has been deleted. Thank you for visiting us! 💐",
  deleteNothing: "We do not have any stored data about you.",
  deleteCancelled: "Deletion cancelled. Your data was not changed.",
  genericError: "Sorry, something went wrong on our side. Please try again in a moment.",
  unknownInput: "I did not understand that. Use the menu below or /help.",
};

const TEXTS: Readonly<Record<Lang, Texts>> = { hy, ru, en };

export function t(lang: Lang): Texts {
  return TEXTS[lang];
}

export const LANGUAGE_PROMPT = "🌐 Ընտրեք լեզուն\nВыберите язык\nChoose your language";

export const LANGUAGE_LABELS: Readonly<Record<Lang, string>> = {
  hy: "🇦🇲 Հայերեն",
  ru: "🇷🇺 Русский",
  en: "🇬🇧 English",
};

export function commandList(lang: Lang): { command: CommandName; description: string }[] {
  return COMMANDS.map((command) => ({ command, description: t(lang).commands[command] }));
}

function nameSuffix(firstName: string | null): string {
  return firstName === null ? "" : `, ${escapeHtml(firstName)}`;
}

export function welcome(lang: Lang, salon: SalonConfig, firstName: string | null, isNew: boolean): string {
  const text = t(lang);
  const greeting = isNew
    ? text.welcomeNew(escapeHtml(salon.name), nameSuffix(firstName))
    : text.welcomeBack(nameSuffix(firstName));
  return `${greeting}\n\n${text.menuHint}`;
}

export function help(lang: Lang, salon: SalonConfig): string {
  const text = t(lang);
  return [text.helpTitle(escapeHtml(salon.name)), "", ...COMMANDS.map((c) => `/${c} — ${text.commands[c]}`)].join(
    "\n",
  );
}

export function services(lang: Lang, salon: SalonConfig): string {
  const text = t(lang);
  const list = salon.services[lang];
  if (list.length === 0) return text.servicesEmpty;
  const lines = list.map((service) => {
    const details = [service.price, service.duration].filter((part): part is string => part !== null);
    const suffix = details.length === 0 ? "" : ` — ${details.map(escapeHtml).join(" · ")}`;
    return `• <b>${escapeHtml(service.name)}</b>${suffix}`;
  });
  const footer = list.some((service) => service.price === null) ? ["", text.priceNote] : [];
  return [text.servicesTitle(escapeHtml(salon.name)), "", ...lines, ...footer].join("\n");
}

export function contact(lang: Lang, salon: SalonConfig): string {
  const lines = [`<b>${escapeHtml(salon.name)}</b>`, "", `📍 ${escapeHtml(salon.address[lang])}`, `📞 ${escapeHtml(salon.contact[lang])}`];
  const hours = salon.workingHours[lang];
  if (hours !== null) lines.push(`🕒 ${escapeHtml(hours)}`);
  return lines.join("\n");
}

export function privacy(lang: Lang, salon: SalonConfig): string {
  return t(lang).privacy(escapeHtml(salon.name));
}
