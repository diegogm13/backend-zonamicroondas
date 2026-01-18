// routes/tags.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// Obtener todos los tags
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM tags ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener tags" });
  }
});

export default router;
