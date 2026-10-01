from app.main import OcrLine, heuristic_parse


def line(text, y, score=0.95):
    return OcrLine(page=0, text=text, score=score, box=[20.0, float(y), 900.0, float(y + 40)])


def main():
    lines = [
        line("Təchizatçı -> Bravo", 20),
        line("faz - 3 AZN - 10 - 30", 120),
        line("tomat - 4 kg - 5.2 - 20.8", 220),
    ]
    result = heuristic_parse(lines)
    assert result["documentMode"] == "freeform", result
    assert result["supplierName"] == "Bravo", result
    assert len(result["items"]) == 2, result

    first, second = result["items"]
    assert first["quantity"] == 10, first
    assert first["unitPrice"] == 3, first
    assert first["total"] == 30, first

    assert second["quantity"] == 4, second
    assert second["unitPrice"] == 5.2, second
    assert second["total"] == 20.8, second
    assert result["total"] == 50.8, result

    print("HANDWRITTEN PARSER OK")
    print(result)


if __name__ == "__main__":
    main()
