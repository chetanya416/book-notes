import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import axios from "axios";

const app = express();
const port = 3000;

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "book",
  password: "",
  port: 5432,
});

db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ---------------- HELPERS ----------------

function getSortQuery(sort) {
  // default sort
  let orderBy = "date_read DESC";

  if (sort === "date_old") orderBy = "date_read ASC";
  if (sort === "date_new") orderBy = "date_read DESC";
  if (sort === "rating_high") orderBy = "rating DESC, date_read DESC";
  if (sort === "rating_low") orderBy = "rating ASC, date_read DESC";

  return orderBy;
}

async function getTopRatedMostRecent() {
  try {
    const result = await db.query(
      "SELECT * FROM books ORDER BY rating DESC, date_read DESC LIMIT 1;"
    );
    return result.rows[0];
  } catch (err) {
    console.log("Error in getTopRatedMostRecent():", err);
    return null;
  }
}

async function getAllBooks(sort) {
  try {
    const orderBy = getSortQuery(sort);
    const result = await db.query(`SELECT * FROM books ORDER BY ${orderBy};`);
    return result.rows;
  } catch (err) {
    console.log("Error in getAllBooks():", err);
    return [];
  }
}

// ---------------- ROUTES ----------------

// HOME PAGE
app.get("/", async (req, res) => {
  const sort = req.query.sort || "date_new";

  try {
    const books = await getAllBooks(sort);
    const topBook = await getTopRatedMostRecent();

    res.render("index.ejs", {
      books: books,
      topBook: topBook,
      sort: sort,
      error: null,
    });
  } catch (err) {
    console.log("Error loading home page:", err);
    res.render("index.ejs", {
      books: [],
      topBook: null,
      sort: sort,
      error: "Something went wrong while loading your notes.",
    });
  }
});

// SEARCH SUGGESTIONS (TOP 5) - OpenLibrary
// called from frontend using axios fetch
app.get("/search", async (req, res) => {
  const q = req.query.q;

  if (!q || q.trim().length < 2) {
    return res.json({ suggestions: [] });
  }

  try {
    const response = await axios.get("https://openlibrary.org/search.json", {
      params: {
        title: q,
        limit: 5,
      },
    });

    const docs = response.data.docs || [];

    const suggestions = docs.slice(0, 5).map((item) => {
      return {
        title: item.title || "",
        author:
          item.author_name && item.author_name.length > 0
            ? item.author_name[0]
            : "",
        cover_i: item.cover_i || null,
      };
    });

    res.json({ suggestions: suggestions });
  } catch (err) {
    console.log("OpenLibrary API error in /search:", err.message);
    res.json({ suggestions: [] });
  }
});

// ADD NEW BOOK NOTE
app.post("/add", async (req, res) => {
  const title = req.body.title?.trim();
  const author = req.body.author?.trim();
  const notes = req.body.notes?.trim();
  const rating = parseInt(req.body.rating);
  const date_read = req.body.date_read;
  const cover_id = req.body.cover_id; // can be empty

  // basic validations
  if (!title || title.length === 0) {
    const books = await getAllBooks("date_new");
    const topBook = await getTopRatedMostRecent();
    return res.render("index.ejs", {
      books: books,
      topBook: topBook,
      sort: "date_new",
      error: "Please enter a book title.",
    });
  }

  if (!author || author.length === 0) {
    const books = await getAllBooks("date_new");
    const topBook = await getTopRatedMostRecent();
    return res.render("index.ejs", {
      books: books,
      topBook: topBook,
      sort: "date_new",
      error: "Please enter the author name.",
    });
  }

  if (isNaN(rating) || rating < 1 || rating > 10) {
    const books = await getAllBooks("date_new");
    const topBook = await getTopRatedMostRecent();
    return res.render("index.ejs", {
      books: books,
      topBook: topBook,
      sort: "date_new",
      error: "Rating must be between 1 and 10.",
    });
  }

  if (!date_read) {
    const books = await getAllBooks("date_new");
    const topBook = await getTopRatedMostRecent();
    return res.render("index.ejs", {
      books: books,
      topBook: topBook,
      sort: "date_new",
      error: "Please select the date read.",
    });
  }

  try {
    await db.query(
      "INSERT INTO books (title, author, notes, rating, date_read) VALUES ($1, $2, $3, $4, $5);",
      [title, author, notes, rating, date_read]
    );

    res.redirect("/");
  } catch (err) {
    console.log("Error adding book note:", err);

    let userError = "Could not add the note. Try again.";

    // unique constraint error
    if (err.code === "23505") {
      userError = "This book by the same author already exists in your notes.";
    }

    const books = await getAllBooks("date_new");
    const topBook = await getTopRatedMostRecent();
    res.render("index.ejs", {
      books: books,
      topBook: topBook,
      sort: "date_new",
      error: userError,
    });
  }
});

// VIEW NOTE PAGE (NO HEADER)
app.get("/notes/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const result = await db.query("SELECT * FROM books WHERE id = $1;", [id]);

    if (result.rows.length === 0) {
      return res.redirect("/");
    }

    const book = result.rows[0];

    res.render("notes.ejs", {
      book: book,
      error: null,
    });
  } catch (err) {
    console.log("Error loading /notes/:id:", err);
    res.render("notes.ejs", {
      book: null,
      error: "Could not open this note.",
    });
  }
});

// EDIT NOTE (rating + notes only)
app.post("/edit/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const rating = parseInt(req.body.rating);
  const notes = req.body.notes?.trim();

  if (isNaN(rating) || rating < 1 || rating > 10) {
    try {
      const result = await db.query("SELECT * FROM books WHERE id = $1;", [id]);
      return res.render("notes.ejs", {
        book: result.rows[0],
        error: "Rating must be between 1 and 10.",
      });
    } catch (err) {
      console.log("Error while validating edit:", err);
      return res.redirect("/");
    }
  }

  try {
    await db.query("UPDATE books SET rating = $1, notes = $2 WHERE id = $3;", [
      rating,
      notes,
      id,
    ]);

    res.redirect(`/notes/${id}`);
  } catch (err) {
    console.log("Error editing note:", err);
    res.redirect(`/notes/${id}`);
  }
});

// DELETE NOTE
app.post("/delete/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    await db.query("DELETE FROM books WHERE id = $1;", [id]);
    res.redirect("/");
  } catch (err) {
    console.log("Error deleting note:", err);
    res.redirect("/");
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
