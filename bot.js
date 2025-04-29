// bot.js
// Телеграм-бот «Пятачок» – погода, курсы, ДР и праздники
// -------------------------------------------------------

const TelegramBot = require("node-telegram-bot-api");
const cron          = require("node-cron");
const dayjs         = require("dayjs");
const axios         = require("axios");
require("dotenv").config();

require("dayjs/locale/ru");
dayjs.locale("ru");

const { getBirthdays, getHolidays } = require("./google");

// -----------------------------------------------------------------------------
// Настройки
// -----------------------------------------------------------------------------
const TOKEN            = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID          = process.env.CHAT_ID;          // группа/канал
const CRON_HOUR_KYIV   = 9;
const CRON_MINUTE      = 0;
const TZ               = "Europe/Kyiv";

// -----------------------------------------------------------------------------
// Утилиты
// -----------------------------------------------------------------------------
const startOfDay = d => d.startOf("day");

const pickClosestForecast = (forecasts, targetHour) => {
  if (!forecasts?.length) return undefined;
  const target = dayjs().hour(targetHour).minute(0).second(0);

  return forecasts.reduce((closest, curr) => {
    const currTime    = dayjs(curr.dt_txt);
    const closestTime = dayjs(closest.dt_txt);
    return Math.abs(currTime.diff(target)) < Math.abs(closestTime.diff(target))
      ? curr
      : closest;
  }, forecasts[0]);
};

const getWeatherEmoji = desc => {
  const d = desc.toLowerCase();
  if (d.includes("дожд") || d.includes("ливень")) return "🌧";
  if (d.includes("облачно"))                     return "☁️";
  if (d.includes("ясно"))                        return "☀️";
  if (d.includes("снег"))                        return "❄️";
  if (d.includes("гроза"))                       return "⛈";
  if (d.includes("ветер"))                       return "🌬";
  return "🌤";
};

const formatTemp = t =>
  typeof t === "number" ? (t > 0 ? `+${Math.round(t)}` : `${Math.round(t)}`) : "—";

const capitalize = txt => txt.charAt(0).toUpperCase() + txt.slice(1);

// -----------------------------------------------------------------------------
// Инициализация бота
// -----------------------------------------------------------------------------
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("message", m => console.log("Chat ID:", m.chat.id));

// -----------------------------------------------------------------------------
// Команда /start
// -----------------------------------------------------------------------------
bot.onText(/\/start/, async msg => {
  const chatId = msg.chat.id;

  const [weather, currencyMsg, birthdayMsg, holidayMsg] = await Promise.all([
    getWeatherForecast(),
    getCurrencyRates(),
    getNearestBirthdayMessage(),
    getNearestHolidayMessage()
  ]);

  const parts = [
    "👋 Привет, пятачок!",
    `Сегодня - ${weather}`,
    currencyMsg,
    birthdayMsg
  ];
  if (holidayMsg) parts.push(holidayMsg);

  bot.sendMessage(chatId, parts.join("\n\n"), { parse_mode: "Markdown" });
});

// -----------------------------------------------------------------------------
// Кнопки-callback
// -----------------------------------------------------------------------------
bot.on("callback_query", async ({ data, message, id }) => {
  const chatId = message.chat.id;

  if (data === "nearest_birthday")
    bot.sendMessage(chatId, await getNearestBirthdayMessage());

  if (data === "nearest_holiday")
    bot.sendMessage(chatId, await getNearestHolidayMessage(), { parse_mode: "Markdown" });

  bot.answerCallbackQuery(id);
});

// -----------------------------------------------------------------------------
// Ежедневная рассылка
// -----------------------------------------------------------------------------
cron.schedule(`${CRON_MINUTE} ${CRON_HOUR_KYIV} * * *`, async () => {
  try {
    await checkBirthdaysAndHolidays();

    const [weather, currencyMsg, birthdayMsg, holidayMsg] = await Promise.all([
      getWeatherForecast(),
      getCurrencyRates(),
      getNearestBirthdayMessage(),
      getNearestHolidayMessage()
    ]);

    const parts = [
      "👋 Добрый день, пятачек!",
      `Сегодня - ${weather}`,
      currencyMsg,
      birthdayMsg
    ];
    if (holidayMsg) parts.push(holidayMsg);

    await bot.sendMessage(CHAT_ID, parts.join("\n\n"), { parse_mode: "Markdown" });
    console.log("✅ Рассылка отправлена");
  } catch (err) {
    console.error("❌ Ошибка в cron-задаче:", err);
  }
}, { timezone: TZ });

// -----------------------------------------------------------------------------
// Погода
// -----------------------------------------------------------------------------
async function getWeatherForecast() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const lat    = 50.4366;
  const lon    = 30.2353;

  try {
    const { data } = await axios.get(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=ru&appid=${apiKey}`
    );

    const today    = dayjs().format("YYYY-MM-DD");
    const tomorrow = dayjs().add(1, "day").format("YYYY-MM-DD");

    const todayForecasts    = data.list.filter(e => e.dt_txt.startsWith(today));
    const tomorrowForecasts = data.list.filter(e => e.dt_txt.startsWith(tomorrow));

    const dayForecast   = pickClosestForecast(todayForecasts, 12);
    const nightForecast = pickClosestForecast(tomorrowForecasts, 3);

    const dayDesc = dayForecast?.weather?.[0]?.description || "нет данных";
    const icon    = getWeatherEmoji(dayDesc);
    const dayTemp   = dayForecast?.main?.temp;
    const nightTemp = nightForecast?.main?.temp;
    const clouds    = dayForecast?.clouds?.all;
    const wind      = dayForecast?.wind?.speed;

    const dateText = `${icon} *${capitalize(dayjs().format("dddd, D MMMM"))}*`;

    return `${dateText}\nПогода: ${capitalize(dayDesc)}\nТемпература: днём ${formatTemp(dayTemp)}° / ночью ${formatTemp(nightTemp)}°\n☁️ Облачность: ${clouds ?? "—"}%\n🌬 Ветер: ${wind ?? "—"} м/с`;
  } catch {
    return "❌ Не удалось загрузить прогноз погоды";
  }
}

// -----------------------------------------------------------------------------
// Курсы валют НБУ
// -----------------------------------------------------------------------------
async function getCurrencyRates() {
  const url = process.env.NBU_API_URL
    || "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew?json";

  try {
    const { data } = await axios.get(url);
    const usd = data.find(c => c.cc === "USD");
    const eur = data.find(c => c.cc === "EUR");
    const pln = data.find(c => c.cc === "PLN");

    return `💱 *Курс валют НБУ:*\n🇺🇸 USD: ${usd?.rate?.toFixed(2)} ₴\n🇪🇺 EUR: ${eur?.rate?.toFixed(2)} ₴\n🇵🇱 PLN: ${pln?.rate?.toFixed(2)} ₴`;
  } catch {
    return "❌ Не удалось загрузить курсы валют";
  }
}

// -----------------------------------------------------------------------------
// Ближайшие ДР
// -----------------------------------------------------------------------------
async function getNearestBirthdayMessage() {
  const birthdays = await getBirthdays();
  const today     = startOfDay(dayjs());

  const upcoming = birthdays
    .map(({ name, date }) => {
      const monthDay = date.format("MM-DD");
      let bday = dayjs(`${today.year()}-${monthDay}`, "YYYY-MM-DD");
      if (bday.isBefore(today, "day")) bday = bday.add(1, "year");
      return { name, date: bday };
    })
    .sort((a, b) => a.date.diff(b.date));

  const nearestDate = upcoming[0]?.date;
  const nearest     = upcoming.filter(b => b.date.isSame(nearestDate, "day"));

  if (!nearest.length) return "🎂 Ближайших дней рождений нет";

  const msg = nearest
    .map(b => {
      const daysLeft = startOfDay(b.date).diff(today, "day");
      return `👤 ${b.name} — ${b.date.format("DD.MM")} (через ${daysLeft} дн.)`;
    })
    .join("\n");

  return `📅 *Ближайшие дни рождения:*\n${msg}`;
}

// -----------------------------------------------------------------------------
// Праздники сегодня
// -----------------------------------------------------------------------------
async function getNearestHolidayMessage() {
  const holidays = await getHolidays();
  const todayKey = dayjs().format("MM-DD");

  const todayHolidays = holidays.filter(h => h.date === todayKey);
  if (!todayHolidays.length) return "";

  const list = todayHolidays.map(h => `🎊 ${h.name}`).join("\n");
  return `📅 *Праздники сегодня (${dayjs().format("DD.MM.YYYY")}):*\n${list}`;
}

// -----------------------------------------------------------------------------
// Напоминалка о ДР
// -----------------------------------------------------------------------------
async function checkBirthdaysAndHolidays() {
  const today     = startOfDay(dayjs());
  const birthdays = await getBirthdays();

  birthdays.forEach(({ name, date }) => {
    const bday = dayjs(`${today.year()}-${date.format("MM-DD")}`, "YYYY-MM-DD");
    const diff = startOfDay(bday).diff(today, "day");

    let msg = "";
    if (diff === 7) msg = `🎉 Через неделю у ${name} день рождения!`;
    else if (diff === 3) msg = `🎈 Через 3 дня у ${name} день рождения!`;
    else if (diff === 1) msg = `🎁 Завтра у ${name} день рождения!`;
    else if (diff === 0) msg = `🎂 Сегодня у ${name} день рождения!`;

    if (msg) bot.sendMessage(CHAT_ID, msg);
  });
}

console.log("Бот запущен ✅");