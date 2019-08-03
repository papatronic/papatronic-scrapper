CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.UpdatedAt = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- En ésta tabla se guardarán las predicciones que generará el motor
-- para no estar haciendo la misma consulta en repetidas ocasiones.
CREATE TABLE Prediction (
    PredictionID SERIAL PRIMARY KEY,
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UpdatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PredictedPrice INT NOT NULL, -- El precio que se predice (se guarda en centavos)
    PredictionDate TIMESTAMPTZ NOT NULL, -- La fecha del precio que se predice
    SourceMarketID INT NOT NULL, -- El ID del mercado de orígen
    EndMarketID INT NOT NULL, -- El ID del mercado de destino
    FOREIGN KEY (SourceMarketID) REFERENCES Market(MarketID),
    FOREIGN KEY (EndMarketID) REFERENCES Market(MarketID),
);

-- En ésta tabla se almacenarán los precios tal cual aparecen en el SNIIM
-- Nota: los precios se almacenarán en centavos, es decir:
-- si la papa cuesta 13.50xKG en base de datos se almacenará como 13.50 * 100 = 1350
-- esto debido a que existen bases de datos que no mantienen buena integridad con los números
-- con punto decimal, de ésta manera, en centavos, solamente se necesitaría multiplicar x100 al
-- momento de retornar la respuesta.
CREATE TABLE Price (
    PriceID SERIAL PRIMARY KEY,
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UpdatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    MinPrice INT NOT NULL, -- Precio mínimo
    MaxPrice INT NOT NULL, -- Precio máximo
    AvgPrice INT NOT NULL, -- Precio frecuente
    Observations VARCHAR NULL, -- Observaciones realizadas por el SNIIM
    SourceMarketID INT NOT NULL, -- El ID del mercado de orígen
    EndMarketID INT NOT NULL, -- El ID del mercado de destino
    TypeOfPrice INT NOT NULL, -- El tipo de precio (presentación comercial o kilogramo calculado)
    PotatoID INT NOT NULL, -- El ID del tipo de la papa a la cual le corresponde el precio
    FOREIGN KEY (SourceMarketID) REFERENCES Market(MarketID),
    FOREIGN KEY (EndMarketID) REFERENCES Market(MarketID),
    FOREIGN KEY (PotatoID) REFERENCES Potato(PotatoID)
);

-- Esta tabla almacenará los mercados (orígenes y destinos)
CREATE TABLE Market (
    MarketID SERIAL PRIMARY KEY,
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UpdatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    MarketName VARCHAR(150) NOT NULL
);

-- Ésta tabla almacenará las papas
CREATE TABLE Potato (
    PotatoID SERIAL PRIMARY KEY,
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UpdatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PotatoSNIIMID INT NOT NULL,
    PotatoName VARCHAR(20) NOT NULL
);

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON Prediction
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON Prices
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON Markets
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON Potato
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

INSERT INTO Potato(PotatoName, PotatoSNIIMID) VALUES('Papa Alpha', 740);
INSERT INTO Potato(PotatoName, PotatoSNIIMID) VALUES('Papa Galeana', 748);
INSERT INTO Potato(PotatoName, PotatoSNIIMID) VALUES('Papa Gema', 749);
INSERT INTO Potato(PotatoName, PotatoSNIIMID) VALUES('Papa Marciana', 753);
INSERT INTO Potato(PotatoName, PotatoSNIIMID) VALUES('Papa San José', 767);