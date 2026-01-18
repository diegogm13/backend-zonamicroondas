// routes/sections.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// Obtener todas las secciones
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM sections ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener secciones" });
  }
});

export default router;
