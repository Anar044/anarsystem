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

    # Regression: real OCR output may split the item name from its numbers
    # and join unit/currency directly to the numeric token.
    split_lines = [
        line("Tohzizatal -> Bravo", 20),
        line("Fazs", 120),
        line("3AZN-10-30", 165),
        line("tomat-4kg-5.2-20.8", 240),
        line("50.8", 320),
    ]
    split_result = heuristic_parse(split_lines)
    assert split_result["documentMode"] == "freeform", split_result
    assert split_result["supplierName"] == "Bravo", split_result
    assert len(split_result["items"]) == 2, split_result

    first, second = split_result["items"]
    assert first["sourceName"].lower() == "fazs", first
    assert first["quantity"] == 10, first
    assert first["unitPrice"] == 3, first
    assert first["total"] == 30, first

    assert second["sourceName"].lower() == "tomat", second
    assert second["quantity"] == 4, second
    assert second["unit"] == "kg", second
    assert second["unitPrice"] == 5.2, second
    assert second["total"] == 20.8, second
    assert split_result["total"] == 50.8, split_result

    print("HANDWRITTEN PARSER OK")
    print(split_result)


if __name__ == "__main__":
    main()
