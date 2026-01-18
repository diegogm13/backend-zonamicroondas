import { Router } from "express";
import {
  createNews,
  listNews,
  getNewsById,
  updateNews,
  deleteNews
} from "../controllers/news.controller.js";

const router = Router();

router.post("/", createNews);
router.get("/", listNews);
router.get("/:id", getNewsById);
router.put("/:id", updateNews);
router.delete("/:id", deleteNews);

export default router;
