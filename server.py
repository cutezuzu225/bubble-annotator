"""
气泡标注后端服务
支持任意 OpenAI 兼容 API 或 Anthropic API
支持 CAD 文件格式转换：DXF / DWG / SVG → PNG
"""
import base64
import io
import json
import os
import re
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

ANALYZE_PROMPT = """你是一个工程图纸分析专家。请仔细分析这张工程图纸，识别所有尺寸标注、公差、直径、角度、表面粗糙度等信息。

请以 JSON 格式返回，格式如下：
{
  "annotations": [
    {
      "value": "Ø12H7",
      "upper_tol": "+0.018",
      "lower_tol": "0",
      "type": "直径",
      "x_pct": 0.35,
      "y_pct": 0.42
    }
  ]
}

字段说明：
- value: 标注的主要内容，如 Ø12、30、R5、45°、Ra1.6 等
- upper_tol: 上偏差，如 "+0.018"，没有则为空字符串
- lower_tol: 下偏差，如 "-0.007"，没有则为空字符串
- type: 类型，只能是以下之一：直径、半径、尺寸、角度、粗糙度、其他
- x_pct: 标注在图纸中水平位置（0.0=最左，1.0=最右）
- y_pct: 标注在图纸中垂直位置（0.0=最上，1.0=最下）

要求：
1. 识别图纸中所有标注，不遗漏
2. 若标注含 ±，拆分为 upper_tol="+值"，lower_tol="-值"
3. 坐标指向标注文字位置
4. 只返回 JSON，不要有其他文字
"""

TYPE_COLORS = {
    "直径":  "#3498db", "半径": "#9b59b6", "尺寸": "#e67e22",
    "角度":  "#2ecc71", "粗糙度": "#1abc9c", "其他": "#607d8b",
}


def call_openai_compatible(api_key, base_url, model, image_b64, media_type):
    """调用 OpenAI 兼容接口（包括 OpenAI / Azure / 第三方）"""
    from openai import OpenAI
    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{media_type};base64,{image_b64}"},
                },
                {"type": "text", "text": ANALYZE_PROMPT},
            ],
        }],
    )
    return response.choices[0].message.content


def call_anthropic(api_key, base_url, model, image_b64, media_type):
    """调用 Anthropic API"""
    import anthropic
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = anthropic.Anthropic(**kwargs)
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": image_b64,
                    },
                },
                {"type": "text", "text": ANALYZE_PROMPT},
            ],
        }],
    )
    return response.content[0].text


@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.json or {}

    # ── 从请求体读取配置（前端设置面板传入）──────────────────────────────────
    api_key  = data.get("api_key")  or os.environ.get("API_KEY") or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = data.get("base_url") or os.environ.get("API_BASE_URL", "")
    model    = data.get("model")    or os.environ.get("API_MODEL", "claude-opus-4-6")
    provider = data.get("provider") or os.environ.get("API_PROVIDER", "anthropic")  # anthropic | openai
    image_b64 = data.get("image", "")

    if not api_key:
        return jsonify({"error": "未提供 API Key，请在设置面板填写或设置环境变量 API_KEY"}), 400
    if not image_b64:
        return jsonify({"error": "缺少 image 字段"}), 400

    # ── 处理 data URL 前缀 ───────────────────────────────────────────────────
    media_type = "image/png"
    if "," in image_b64:
        header, image_b64 = image_b64.split(",", 1)
        m = re.search(r"data:([^;]+);", header)
        if m:
            media_type = m.group(1)

    # ── 调用模型 ──────────────────────────────────────────────────────────────
    try:
        if provider == "anthropic":
            raw = call_anthropic(api_key, base_url or None, model, image_b64, media_type)
        else:
            # openai 或任意兼容接口
            raw = call_openai_compatible(api_key, base_url or "https://api.openai.com/v1", model, image_b64, media_type)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # ── 解析 JSON ──────────────────────────────────────────────────────────────
    raw = raw.strip()
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not json_match:
        return jsonify({"error": "模型未返回有效 JSON", "raw": raw}), 500

    try:
        result = json.loads(json_match.group())
    except json.JSONDecodeError as e:
        return jsonify({"error": f"JSON 解析失败: {e}", "raw": raw}), 500

    annotations = result.get("annotations", [])
    for ann in annotations:
        ann["color"] = TYPE_COLORS.get(ann.get("type", "other"), "#607d8b")

    return jsonify({"annotations": annotations, "count": len(annotations)})


@app.route("/api/convert", methods=["POST"])
def convert_cad():
    """将 CAD 文件（DXF/DWG/SVG）转换为 PNG base64"""
    if "file" not in request.files:
        return jsonify({"error": "缺少 file 字段"}), 400

    f = request.files["file"]
    filename = f.filename.lower()
    data = f.read()

    try:
        if filename.endswith(".svg"):
            png_bytes = _svg_to_png(data)

        elif filename.endswith(".dxf"):
            png_bytes = _dxf_to_png(data)

        elif filename.endswith(".dwg"):
            # ezdxf 0.19+ 支持读取 DWG（部分版本）
            png_bytes = _dwg_to_png(data, filename)

        else:
            return jsonify({"error": f"不支持的格式：{filename}"}), 400

        b64 = base64.b64encode(png_bytes).decode()
        return jsonify({"image": f"data:image/png;base64,{b64}"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _svg_to_png(data: bytes) -> bytes:
    try:
        import cairosvg
        return cairosvg.svg2png(bytestring=data, scale=2)
    except ImportError:
        # fallback：用 Pillow + cairosvg 不可用时尝试 Inkscape CLI
        import subprocess, shutil
        if shutil.which("inkscape"):
            with tempfile.NamedTemporaryFile(suffix=".svg", delete=False) as sf:
                sf.write(data); svg_path = sf.name
            out_path = svg_path.replace(".svg", ".png")
            subprocess.run(["inkscape", svg_path, "--export-filename", out_path,
                            "--export-dpi", "150"], check=True, capture_output=True)
            with open(out_path, "rb") as pf:
                return pf.read()
        raise RuntimeError("SVG 转换需要 cairosvg 或 inkscape，请运行：pip install cairosvg")


def _dxf_to_png(data: bytes) -> bytes:
    import ezdxf
    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tf:
        tf.write(data); dxf_path = tf.name

    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()

    fig = plt.figure(figsize=(16, 12), dpi=150, facecolor="white")
    ax = fig.add_axes([0, 0, 1, 1])
    ctx = RenderContext(doc)
    out = MatplotlibBackend(ax)
    Frontend(ctx, out).draw_layout(msp, finalize=True)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", facecolor="white")
    plt.close(fig)
    os.unlink(dxf_path)
    return buf.getvalue()


def _dwg_to_png(data: bytes, filename: str) -> bytes:
    import ezdxf
    # ezdxf 尝试直接读取 DWG（需要 ezdxf >= 0.19 且文件版本 <= R2018）
    with tempfile.NamedTemporaryFile(suffix=".dwg", delete=False) as tf:
        tf.write(data); dwg_path = tf.name
    try:
        doc = ezdxf.readfile(dwg_path)
    except Exception:
        os.unlink(dwg_path)
        raise RuntimeError("DWG 读取失败，请将文件另存为 DXF 格式后重试（AutoCAD: 文件→另存为→DXF）")

    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    msp = doc.modelspace()
    fig = plt.figure(figsize=(16, 12), dpi=150, facecolor="white")
    ax = fig.add_axes([0, 0, 1, 1])
    ctx = RenderContext(doc)
    out = MatplotlibBackend(ax)
    Frontend(ctx, out).draw_layout(msp, finalize=True)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", facecolor="white")
    plt.close(fig)
    os.unlink(dwg_path)
    return buf.getvalue()


@app.route("/api/test", methods=["POST"])
def test_connection():
    data = request.json or {}
    api_key  = data.get("api_key", "").strip()
    base_url = data.get("base_url", "").strip()
    model    = data.get("model", "").strip()
    provider = data.get("provider", "openai")

    if not api_key:
        return jsonify({"ok": False, "error": "API Key 为空"}), 400

    try:
        if provider == "anthropic":
            import anthropic
            kwargs = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            client = anthropic.Anthropic(**kwargs)
            resp = client.messages.create(
                model=model or "claude-opus-4-6",
                max_tokens=16,
                messages=[{"role": "user", "content": "hi"}],
            )
            reply = resp.content[0].text.strip()
        else:
            from openai import OpenAI
            client = OpenAI(
                api_key=api_key,
                base_url=base_url or "https://api.openai.com/v1",
            )
            resp = client.chat.completions.create(
                model=model or "gpt-4o",
                max_tokens=16,
                messages=[{"role": "user", "content": "hi"}],
            )
            reply = resp.choices[0].message.content.strip()

        return jsonify({"ok": True, "reply": reply})

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 200


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print("🚀 服务启动：http://localhost:5001")
    print("   支持通过前端设置面板配置 API Provider / Key / Model")
    app.run(port=5001, debug=True)
