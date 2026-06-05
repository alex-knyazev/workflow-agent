const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://www.kommersant.ru/theme/2017";

async function parseKommersantNews() {
  try {
    console.log("📡 Загружаем страницу...");
    const response = await axios.get(URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const $ = cheerio.load(response.data);
    const news = [];

    // Находим блоки новостей (анализ структуры страницы)

    // Если не нашли по первым селекторам — пробуем альтернативные
    $("article, .news-item, .theme-news-item").each((i, element) => {
      const title = $(element).find("a").first().text().trim();
      const link = $(element).find("a").first().attr("href");
      const dateString = $(element).find("p, .uho__tag").first().text().trim();

      const date = parseCustomDate(dateString);

      if (title && link) {
        news.push({
          title: title,
          link: link.startsWith("http")
            ? link
            : `https://www.kommersant.ru${link}`,
          date: date,
          description: "",
        });
      }
    });

    // Выводим результат
    console.log(`\n✅ Найдено новостей: ${news.length}\n`);
    console.log("=".repeat(80));

    news.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.title}`);
      console.log(`   📅 ${item.date || "дата не указана"}`);
      console.log(`   🔗 ${item.link}`);
      if (item.description) {
        console.log(`   📝 ${item.description}...`);
      }
      console.log("-".repeat(80));
    });

    return news;
  } catch (error) {
    console.error("❌ Ошибка:", error.message);
    if (error.response) {
      console.error(`   Статус: ${error.response.status}`);
    }
    return [];
  }
}

function parseCustomDate(dateStr) {
  const [datePart, timePart] = dateStr.split(", ");
  const [day, month, year] = datePart.split(".");
  const [hours, minutes] = timePart.split(":");

  return new Date(year, month - 1, day, hours, minutes);
}

parseKommersantNews();
